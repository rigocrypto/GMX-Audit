# Billing Webhook Monitoring & Recovery

Production-grade monitoring for the Railway-hosted billing webhook
(`https://billing-webhook-production.up.railway.app`). The design follows one
loop: **detect → notify → deduplicate → escalate → recover → document.**

The guiding rule: **an outage must never be visible only as a red GitHub Actions
run.** A monitor that turns red without notifying anyone is just passive logging.

## Architecture at a glance

| Layer | Role | Cadence | Threshold | Notifies via |
| --- | --- | --- | --- | --- |
| **Railway-native notifications** (primary) | Crash / failed-deploy detection | deploy + process events | process crash / deploy fail | Slack / email (Railway) |
| **GitHub Actions `Billing Health Alert`** (backup) | HTTP `/health` probe + incident record | every 30 min (best-effort) | 2 consecutive in-run probes | Deduplicated GitHub issue + optional webhook/email |
| **Better Stack / UptimeRobot** (fallback/upgrade — §5) | Continuous external HTTP probe | every 5 min | 2 consecutive failures | Slack / email / SMS |

Multiple independent detectors on different infrastructure means none is a single
point of failure. GitHub's scheduled workflows are explicitly best-effort and can
be delayed or skipped, so they are the **backup**, never the primary. Note that
Railway-native alerting is process/deploy-level and will **not** catch a running
service returning `404/5xx` on `/health` — the HTTP probes (backup + §5) cover
that gap (see §1 limitations).

## 1. Primary detector — Railway-native notifications

> **Change production settings by hand.** Do not script or automate changes to
> Railway or any external monitor. The steps below are a manual runbook; apply
> them in the provider UI and verify each one.

Chosen primary: **Railway-native notifications** (lowest maintenance, no external
credentials to rotate). Better Stack is the documented fallback/upgrade when the
stricter threshold + escalation policy is required (see §5).

### Target settings for the primary `/health` monitor

| Setting | Value |
| --- | --- |
| Endpoint | `https://billing-webhook-production.up.railway.app/health` |
| Method | `GET` |
| Expected status | `200` |
| Expected body | contains `"ok":true` |
| Check frequency | 5 minutes |
| Failure threshold | 2 consecutive failures |
| Initial notification | ~10 minutes after persistent failure (interval × threshold) |
| Escalation | 20–30 minutes if still down |
| Recovery notification | Enabled |
| GitHub Actions backup | every 30 minutes (§2) |

### Primary notification recipients

Document the real recipients here (kept in the repo so on-call is unambiguous):

- **Primary (page immediately):** `<ops-oncall@your-domain>` / Slack `#billing-alerts`
- **Secondary (escalation):** `<engineering-lead@your-domain>`
- **Recovery notices:** same channel as primary

> Replace the placeholders above with the real addresses/channel before relying
> on this. Prefer a Slack/Discord webhook or platform-native channel over
> SMTP-only — SMTP credentials expire, get misconfigured, and fail silently.

### Railway-native setup steps (manual)

1. **Service healthcheck path.** Railway → project → **billing-webhook** service →
   **Settings → Deploy → Healthcheck Path** → set to `/health` (confirm it is
   already `/health`; the deploy logs show `Starting Healthcheck … Path: /health
   … Healthcheck succeeded`). This gates *deploys* on `/health` returning 200.
2. **Deploy/crash notifications.** Railway → project → **Settings → Notifications**
   (or **Webhooks**) → add a destination (Slack/Discord webhook or email) and
   enable deployment **Failed** / **Crashed** events. Point it at the primary
   recipients above.
3. **Restart policy.** Service → **Settings → Deploy → Restart Policy** →
   `On Failure` so a crashed process restarts automatically; each crash/restart
   then fires the notification from step 2.
4. **Verify** using the checklist in §6.

### Railway-native limitations (read before relying on it)

Railway's native health signals are **deploy-time and process-level**, not a
continuous external HTTP uptime monitor:

- The healthcheck path only runs **during a deployment**; it does not re-probe
  `/health` on an interval afterwards.
- Notifications fire on **deploy/process** events (build failed, deploy failed,
  crash, restart) — not on "the process is running but the HTTP route returns
  404/5xx."
- **This exact incident** (a sustained `404 /health` for ~3 days while the
  service showed **Active**) would **not** have triggered Railway-native alerts,
  because the process never crashed. It was only caught by an HTTP probe.

Therefore Railway-native alerting is necessary but **not sufficient** on its own
for this failure mode. The two HTTP-probing safety nets cover the gap:

- the **GitHub Actions backup** (§2), which hits the endpoint every 30 min, and
- **Better Stack / UptimeRobot** (§5) if you need 5-minute detection latency and
  a formal escalation policy — which is why it is the recommended upgrade path.

## 2. Backup detector — GitHub Actions `Billing Health Alert`

Workflow: [`.github/workflows/billing-health-alert.yml`](../.github/workflows/billing-health-alert.yml)
Logic: [`src/billing/healthAlert.ts`](../src/billing/healthAlert.ts)

- **Cadence:** every 30 minutes (`cron: */30 * * * *`). Relaxed on purpose — GH
  schedules are not guaranteed on time, so tight cadence there is false comfort.
- **Detect:** probes `/health` up to `BILLING_HEALTH_ALERT_PROBES` (default **2**)
  times, ~15s apart, **within a single run**. An outage is declared only if
  *all* probes fail. This provides "2 consecutive failures" semantics without
  relying on cross-run state (GitHub runners are ephemeral). Any single probe
  succeeding is treated as healthy — a transient blip is not an outage.
- **Notify + deduplicate:** on a confirmed outage it opens **one** GitHub issue
  labelled `billing-incident` (see fallback below). One issue per incident, never
  one per failed run. Optional webhook/email fire on the same event if configured.
- **Escalate:** if the same incident is still open after
  `BILLING_HEALTH_ESCALATE_AFTER_MIN` (default **20** min), it adds a single
  escalation comment + the `status:escalated` label and re-notifies. Plain
  ongoing failures in between stay quiet — no per-run noise.
- **Recover:** on the next healthy run it comments the recovery + closes the
  issue automatically, and sends a recovery notification.

## 3. Notification fallback — deduplicated GitHub issue

Implemented in [`src/billing/incidentIssue.ts`](../src/billing/incidentIssue.ts).
This is the **always-on** channel: it needs no external credentials, only the
workflow's built-in `GITHUB_TOKEN` and `issues: write` permission.

- **Dedupe key:** an open issue with label `billing-incident` and a hidden
  marker `<!-- billing-health-incident -->` in the body. If one is already open,
  no new issue is created.
- **Lifecycle:** `created` → (optionally) `escalated` → `closed on recovery`.
  Closing uses `state_reason: completed`.
- **Concurrency:** the workflow uses a `concurrency` group so two runs can't race
  on create/close.

## 4. Startup config check (no silent no-op)

On every run, `reportChannelConfig()` lists the wired-up channels and emits a
loud `::warning::` when **none** is configured:

```
::warning::[billing:health-alert] NO notification channel is configured. ...
```

This prevents the job from looking operational while having nowhere to send
alerts. In GitHub Actions the GitHub-issue fallback always counts as a channel
(token + `issues: write` are present), so the warning only appears if that path
is also unavailable.

## 5. Fallback / upgrade — Better Stack (or UptimeRobot)

Use this when Railway-native alerts cannot express the required policy — a
5-minute interval, a **2-consecutive-failure** threshold, timed escalation, and
recovery notifications — or when you want an HTTP probe independent of both
Railway and GitHub. Any equivalent monitor (Pingdom, Checkly) works too.

> Configure this in the provider UI manually. Do not automate changes to
> production monitors.

### Better Stack (Better Uptime) — recommended fallback

1. **Monitors → Create monitor → HTTP(S).**
2. URL: `https://billing-webhook-production.up.railway.app/health`; Method `GET`.
3. **Expected status code:** `200`.
4. **Keyword / body check:** required to contain `"ok":true` (so a `200` with a
   wrong body still alarms).
5. **Check frequency:** every 5 minutes.
6. **Confirmation:** "Verify with a second check / require 2 failed checks before
   alerting" → **2** consecutive failures (~10 min to first alert).
7. **On-call / Escalation policy:** notify Primary immediately on incident; if
   unacknowledged after **20–30 min**, escalate to Secondary (see §1 recipients).
8. **Recovery notification:** enabled (Better Stack sends resolve notices by
   default).
9. Attach channels: Slack/Email/SMS as desired (at least two independent ones).

### UptimeRobot — minimal fallback

- Monitor type **HTTP(s)**, URL `…/health`, interval **5 minutes**.
- **Keyword monitoring:** alert when response does **not** contain `"ok":true`.
- Alert contacts: set to Primary + Secondary; enable "notify when back up".
- Threshold note: UptimeRobot's free tier alerts on the first failed check.
  Where supported, set "send notification after **2** occurrences" to match the
  2-consecutive-failure policy; otherwise treat the extra sensitivity as
  acceptable and rely on the recovery notice to close the loop.

## 6. Production-verification checklist (manual)

Run after wiring up monitors. Do **not** automate against production.

- [ ] `curl -s https://billing-webhook-production.up.railway.app/health` →
      `200` and body `{"ok":true}`.
- [ ] Railway healthcheck path is `/health`; restart policy is `On Failure`.
- [ ] Railway deploy/crash notification fires to the Primary channel (trigger a
      manual redeploy and confirm the notification arrives).
- [ ] Primary monitor (Better Stack/Railway) recipients match §1 and are
      reachable (send a test alert).
- [ ] GitHub Actions backup: `gh workflow run billing-health-alert.yml` →
      run succeeds; with the endpoint healthy no issue is opened.
- [ ] Simulated outage (point `BILLING_HEALTHCHECK_URL` at an unreachable URL via
      a manual `workflow_dispatch`, or temporarily break a staging route):
      exactly **one** `billing-incident` issue opens.
- [ ] Recovery: on the next healthy run the incident issue is **commented and
      closed automatically**, and a recovery notice is sent.
- [ ] Repeat-failure run does **not** open a second issue (dedupe holds).
- [ ] No secrets/tokens/internal URLs appear in the public issue body (host-only).

## Configuration reference

Workflow env / secrets (all push channels are optional; the GitHub issue is the
built-in fallback):

| Variable | Purpose | Default |
| --- | --- | --- |
| `BILLING_HEALTHCHECK_URL` | Endpoint to probe | Railway `/health` URL |
| `BILLING_HEALTH_ALERT_PROBES` | Consecutive in-run probes required to declare an outage | `2` |
| `BILLING_HEALTH_ALERT_PROBE_GAP_MS` | Delay between probes | `15000` |
| `BILLING_HEALTH_ALERT_TIMEOUT_MS` | Per-probe timeout | `10000` |
| `BILLING_HEALTH_ESCALATE_AFTER_MIN` | Age before an open incident escalates | `20` |
| `BILLING_ALERT_WEBHOOK_URL` | Slack/Discord webhook (optional push) | — |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Email transport (optional push) | — |
| `BILLING_ALERT_EMAIL_TO` / `BILLING_ALERT_EMAIL_FROM` | Email recipients/sender (optional push) | — |
| `GITHUB_TOKEN` / `GITHUB_REPOSITORY` | Incident-issue fallback (auto-set in Actions) | — |

## Incident response flow

1. **Alert received** (external monitor and/or GitHub `billing-incident` issue).
2. Check Railway service `billing-webhook`: deploy status, crash loop, health logs.
   `railway logs --service billing-webhook --lines 200`.
3. Confirm `GET /health` returns `200 {"ok":true}` once restored.
4. The GitHub incident issue **closes itself** on the next healthy backup run.
   If you fixed it out-of-band, you can close the issue manually — the next
   outage opens a fresh one.

## Verifying the pipeline

```powershell
# Unit tests (probe threshold + config-check)
npm run billing:test

# One-off live probe (no token locally => issue path is a safe no-op)
npm run billing:health-alert

# Force the backup workflow to run
gh workflow run billing-health-alert.yml
```
