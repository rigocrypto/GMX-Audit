# Ops Runbook

Use this runbook for repeatable delivery across team members.

## Standard Delivery Command

```powershell
npm run deliverable -- --mode auto --rpc <RPC> --block <BLOCK> --client <CLIENT> --engagement <ENGAGEMENT> --zip --usd --risk --report-html --report-md --security --ai
```

Intake-driven execution (recommended):

```powershell
npm run preflight -- --intake docs/intake-template.json --strict --require-security
npm run deliverable -- --intake docs/intake-template.json
```

Multi-target engagement:

```powershell
npm run preflight -- --intake intake.json --strict
npm run deliverable -- --intake intake.json
```

Re-run only target 2:

```powershell
npm run deliverable -- --intake intake.json --intake-target-index 1
```

Fail-fast batch run:

```powershell
npm run deliverable -- --intake intake.json --batch-fail-fast
```

Retry transient RPC failures:

```powershell
npm run deliverable -- --intake intake.json --batch-retry 2 --batch-retry-backoff-ms 2000
```

Client-ready zip naming and engagement manifest are generated automatically in batch mode:

- Per-target zip: `<client>_<engagement>_<chain>_<mode>_<resolvedBlock>_<targetHash8>.zip`
- Root artifact: `engagement.manifest.json`

Batch execution policy:

- Default is continue-on-error (`--batch-continue-on-error`), so all targets run and failures are documented in root `index.json`.
- Use `--batch-fail-fast` to stop scheduling additional targets after the first failure.

## Batch Modes

- Preflight + retry:

```powershell
npm run deliverable -- --intake intake.json --batch-preflight 1 --batch-retry 2
```

- Strict CI:

```powershell
npm run deliverable -- --intake intake.json --batch-preflight 1 --strict --batch-fail-fast
```

- Skip preflight (dev only):

```powershell
npm run deliverable -- --intake intake.json --batch-preflight 0
```

- Archive root engagement bundle to S3:

```powershell
npm run deliverable -- --intake intake.json --batch-archive s3://my-bucket/gmx-audits
```

- Archive root engagement bundle to IPFS (Pinata):

```powershell
npm run deliverable -- --intake intake.json --batch-archive ipfs://pinata
```

- Notify client by email after batch completion:

```powershell
npm run deliverable -- --intake intake.json --batch-archive s3://my-bucket/gmx-audits --batch-notify security@client.com
```

Gate policy:

- Public RPC: keep `--gate-mode warn` to avoid hard-fail on partial historical security data.
- Archive RPC: use stricter gating when full pinned-block completeness is required.

Delivery environment variables:

- S3 archive: `AWS_REGION` (and standard AWS credentials in env or profile).
- IPFS archive (Pinata): `PINATA_JWT` or `PINATA_API_KEY` + `PINATA_API_SECRET`.
- Email notify: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, optional `EMAIL_FROM`.

Delivery outputs:

- Root `engagement.manifest.json` includes `archive`, `archiveUrl`, `archiveHash`, and `notification` when enabled.
- Root archive zip path/hash are also recorded for chain-of-custody.

Observability metrics:

- `engagement.manifest.json.metrics` includes:
- `batch_duration_ms`
- `targets_total`
- `targets_passed`
- `targets_flaked`
- `avg_rpc_grade`
- `top_risk_severity`
- `archive_success`

Quick metrics check:

```bash
jq '.metrics | {batch_duration_ms, targets_passed, avg_rpc_grade, archive_success}' outputs/bundles/*/engagement.manifest.json
```

Docker workflow:

```bash
npm run docker:build
npm run docker:run
```

Client demo flow (requires archive + notify env):

```bash
export BATCH_ARCHIVE_TARGET=s3://demo-bucket/gmx-audits
export BATCH_NOTIFY_EMAIL=client@example.com
npm run demo-client
```

## Tier 7 Monitoring

Validate manifest contract before export:

```bash
npm run manifest:validate
```

Export metrics artifacts from engagement manifests (defaults to `outputs/bundles/LATEST.json` when present):

```bash
npm run metrics:export
```

Generated outputs:

- `outputs/metrics/gmx_audit_batch.prom`
- `outputs/metrics/metrics.csv`
- `outputs/metrics/metrics.ndjson`
- `grafana-dashboard.json`

Prometheus labels:

- `client`
- `engagement`
- `batch_root`
- `tool_version`
- `chain_count`

Prometheus counters/gauges include:

- `gmx_audit_batch_passed`
- `gmx_audit_targets_total`
- `gmx_audit_targets_passed`
- `gmx_audit_target_failed_total`
- `gmx_audit_targets_flaked`
- `gmx_audit_transient_retry_total`

## Tier 7 Billing Webhook

Run queue-based billing webhook worker:

```bash
export STRIPE_SECRET_KEY=...
export STRIPE_WEBHOOK_SECRET=...
export BATCH_ARCHIVE_TARGET=s3://my-bucket/gmx-audits
export DEFAULT_NOTIFY_EMAIL=ops@example.com
npm run billing:start
```

Behavior:

- Verifies Stripe signature before accepting events.
- Enqueues `checkout.session.completed` into `outputs/billing-queue/jobs/`.
- Worker drains queue asynchronously and runs deliverable outside webhook response path.
- Event dedupe uses `outputs/billing-queue/processed-events.json`.
- Intake provenance is validated against `INTAKES_DIR` / `INTAKE_BASE_PATH` before queueing.
- File lock `outputs/billing-queue/worker.lock` enforces single-worker processing.

Single-instance constraint:

- Run one billing worker replica only while file-lock mode is enabled.
- For multi-replica operation, replace file lock with a shared lock backend (Redis/DB).

## Billing Worker Health Monitoring

Endpoint:

- `GET http://localhost:3000/health`

Expected healthy response:

```json
{
  "ok": true,
  "concurrency": 1,
  "workerRunning": false,
  "counts": {
    "jobs": 0,
    "inprogress": 0,
    "failed": 0
  }
}
```

Alert thresholds:

| Condition | Severity | Action |
| --- | --- | --- |
| `counts.failed > 0` | High | Inspect `failed/`, fix the root cause, then re-queue manually. |
| `counts.inprogress > 0` and `workerRunning === false` | High | Treat as an orphaned job. Restart the worker; recovery should replay the job automatically. |
| `counts.jobs > 5` for more than 10 minutes | Medium | Worker is stuck or under-provisioned. Check worker logs and host health. |
| `workerRunning === true` for more than 30 minutes | High | Deliverable execution is likely hung. Kill and restart the worker. |
| `ok === false` or endpoint unreachable | Critical | Worker is down. Restart immediately. |

Operational notes:

- `concurrency` is fixed at `1` in the current file-lock implementation.
- Run only one billing worker replica while `worker.lock` is the coordination mechanism.
- For multi-replica scaling, replace the file lock with Redis `SETNX` or another shared lock backend.

Alert rules for JSON logs:

- `event = "job.failed_permanently"`: page immediately and inspect `lastExitCode`, retry history, and the failed job payload.
- `event = "job.corrupt_quarantined"`: page immediately and inspect the quarantined queue file for corruption or partial writes.
- `event = "job.retry_scheduled"` with `attempts >= maxAttempts - 1`: warn and investigate before the next retry exhausts the job.
- `event = "lock.stale_cleared"`: warn and confirm the previously running worker crashed rather than being replaced incorrectly.

## Production Rollout Checklist

### Day 0 Deployment Checklist

1. Confirm Node and dependencies.
2. Confirm required secrets are present.
3. Start the billing worker.
4. Trigger one Stripe smoke event.
5. Verify queue outputs and post-run checks.

Copy/paste sequence:

```powershell
node -v
npm ci

$env:STRIPE_SECRET_KEY.Length
$env:STRIPE_WEBHOOK_SECRET.Length
$env:BATCH_ARCHIVE_TARGET
$env:AWS_REGION

node scripts/billingWebhook.js

stripe listen --forward-to localhost:3000/webhook
stripe trigger checkout.session.completed

Get-Content outputs/billing-queue/processed-sessions.json
Get-Content outputs/bundles/LATEST.json
npm run manifest:roundtrip
npm run metrics:test
```

### Quick state snapshot

PowerShell:

```powershell
Invoke-RestMethod http://localhost:3000/health | ConvertTo-Json -Depth 5
$queue = "outputs/billing-queue"
$failedDir = Join-Path $queue "failed"
if (Test-Path $failedDir) {
  $latest = Get-ChildItem $failedDir -Filter *.json | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($latest) {
    Write-Host "LATEST_FAILED=$($latest.Name)"
    (Get-Content $latest.FullName -Raw | ConvertFrom-Json) |
      Select-Object eventId,sessionId,intakePath,lastExitCode,attempts,maxAttempts,lastAttemptAt,attemptHistory |
      ConvertTo-Json -Depth 6
  } else {
    Write-Host "LATEST_FAILED=none"
  }
}

$eventsPath = Join-Path $queue "processed-events.json"
$sessionsPath = Join-Path $queue "processed-sessions.json"
$eventCount = if (Test-Path $eventsPath) { ((Get-Content $eventsPath -Raw | ConvertFrom-Json) | Measure-Object).Count } else { 0 }
$sessionCount = if (Test-Path $sessionsPath) { ((Get-Content $sessionsPath -Raw | ConvertFrom-Json) | Measure-Object).Count } else { 0 }
Write-Host "PROCESSED_EVENTS=$eventCount"
Write-Host "PROCESSED_SESSIONS=$sessionCount"
```

Health-to-alert probe:

```powershell
$h = Invoke-RestMethod http://localhost:3000/health
if ($h.counts.failed -gt 0) { exit 2 }
if ($h.counts.jobs -gt 5) { exit 1 }
exit 0
```

Recommended environment variables:

- `NODE_VERSION=20`
- `INTAKE_BASE_PATH=./inputs`
- `INTAKES_DIR=./inputs`
- `BATCH_PREFLIGHT=1`
- `BATCH_FAIL_FAST=1`
- `BATCH_RETRY=2`
- `BATCH_RETRY_BACKOFF_MS=2000`
- `BILLING_POLL_MS=5000`
- `BILLING_MAX_ATTEMPTS=3`

Billing and delivery secrets:

- `STRIPE_SECRET_KEY=sk_test_...` for test-mode rollout, then promote to the live key at cutover.
- `STRIPE_WEBHOOK_SECRET=whsec_...` from `stripe listen` or the Stripe dashboard.
- `BATCH_ARCHIVE_TARGET=s3://audit-bundles/engagements/`
- `AWS_REGION=us-east-1`
- `AWS_ACCESS_KEY_ID=...`
- `AWS_SECRET_ACCESS_KEY=...`
- `BATCH_NOTIFY_EMAIL=client@example.com` when a default delivery recipient is required.
- `SMTP_HOST=...`
- `SMTP_PORT=587`
- `SMTP_USER=...`
- `SMTP_PASS=...`
- `EMAIL_FROM=no-reply@example.com`

Host-mode worker start:

```powershell
$env:STRIPE_SECRET_KEY='sk_test_...'
$env:STRIPE_WEBHOOK_SECRET='whsec_...'
$env:INTAKE_BASE_PATH='./inputs'
$env:INTAKES_DIR='./inputs'
$env:BILLING_POLL_MS='5000'
$env:BILLING_MAX_ATTEMPTS='3'
node scripts/billingWebhook.js
```

Stripe CLI smoke test:

```powershell
stripe listen --forward-to localhost:3000/webhook
stripe trigger checkout.session.completed
```

### Stripe checkout metadata required for production

When creating a real Stripe Checkout Session, include billing metadata so the worker can resolve the correct intake file for that client engagement.

Minimum metadata:

```json
{
  "metadata": {
    "intakePath": "inputs/client-name.json"
  }
}
```

Notes:

- `intakePath` is the simplest production integration path when the checkout creator already knows the exact intake file.
- `intakeId` is also supported and resolves to `INTAKES_DIR/<intakeId>.json`.
- If neither `intakePath` nor `intakeId` is provided, the worker falls back to `DEFAULT_INTAKE_PATH`.
- `stripe trigger checkout.session.completed` usually sends synthetic metadata-free payloads, so fallback behavior is expected in local smoke tests.

Expected worker events:

- `worker.started`
- `job.enqueued`
- `job.started`
- `job.succeeded`

Post-event verification:

```powershell
npm run manifest:roundtrip
npm run metrics:test
Get-Content outputs/billing-queue/processed-sessions.json
Get-Content outputs/bundles/LATEST.json
```

Container-mode smoke test:

```powershell
npm run docker:build
docker run --rm \
  -v ${PWD}/inputs:/app/inputs \
  -v ${PWD}/outputs:/app/outputs \
  -e STRIPE_SECRET_KEY \
  -e STRIPE_WEBHOOK_SECRET \
  -e INTAKE_BASE_PATH=/app/inputs \
  -e INTAKES_DIR=/app/inputs \
  -e BATCH_ARCHIVE_TARGET \
  gmx-audit:latest --intake /app/inputs/intake-template.json --batch-preflight 1 --strict
```

Rollout exit criteria:

- Stripe test event reaches `job.succeeded` without retries.
- `processed-sessions.json` contains the checkout session id.
- `LATEST.json` points to the new bundle.
- `npm run manifest:roundtrip` passes.
- `npm run metrics:test` passes.

## Production Webhook - VALIDATED

### Deployment

- Platform: Railway
- URL: <https://billing-webhook-production.up.railway.app>
- Webhook: <https://billing-webhook-production.up.railway.app/api/webhooks/stripe>
- Health: <https://billing-webhook-production.up.railway.app/health> -> 200 OK

### Stripe Dashboard

- Destination name: production-billing-webhook
- API version: 2025-04-30.basil
- Events (subscribed):
  - checkout.session.completed
  - invoice.paid
  - invoice.payment_failed
  - customer.subscription.updated
  - customer.subscription.deleted
  - customer.subscription.created

### Environment Variables (Railway)

- STRIPE_SECRET_KEY: sk_live_...
- STRIPE_WEBHOOK_SECRET: whsec_live_...
- BILLING_PORTAL_RETURN_URL: <https://billing-webhook-production.up.railway.app/return>
- BILLING_PORTAL_API_TOKEN: [secure token]
- NODE_ENV: production
- BILLING_TRUST_PROXY: 1  # required; avoids ERR_ERL_UNEXPECTED_X_FORWARDED_FOR behind Railway proxy

### Validation

- Local: 12/12 tests passing
- Production health check: 200 OK
- Webhook endpoint: live and responding

### v1.1.1 Production Validation (2026-04-24)

- Flow: one-time checkout (mode=payment)
- Event: checkout.session.completed -> 200 OK (evt_1TPbopG8p0q8xBb0D8Qgpcc8)
- Payment: $0.50 USD, livemode=true, status=complete, payment_status=paid
- Charge: amount_captured=50, outcome=authorized, network_status=approved_by_network
- Metadata: client_id propagated through checkout session -> webhook handler
- Release tag: v1.1.1

### Stripe webhook failure triage

1. Check Stripe Dashboard -> Developers -> Webhooks -> Event deliveries.
1. Confirm endpoint URL matches production exactly: <https://billing-webhook-production.up.railway.app/api/webhooks/stripe>.
1. Confirm Railway secret matches the active live endpoint secret: STRIPE_WEBHOOK_SECRET=whsec_live_....
1. Confirm service health endpoint returns 200: GET <https://billing-webhook-production.up.railway.app/health>.
1. Check recent service logs: `railway logs --service billing-webhook --lines 200`.
1. If signature verification fails, check live vs test secret mismatch and whether the endpoint was recreated without updating Railway.
1. If delivery failed temporarily, resend the failed event from Stripe Dashboard and verify idempotent handling avoids duplicate side effects.
1. If proxy or rate-limit errors appear, confirm BILLING_TRUST_PROXY=1 is set in Railway.

### Minimal billing alerts (v1)

Configure at least one immediate channel:

- BILLING_ALERT_WEBHOOK_URL=<https://hooks.slack.com/...> (or Discord webhook URL)
- BILLING_ALERT_EMAIL_TO=ops@example[dot]com,security@example[dot]com
- BILLING_ALERT_EMAIL_FROM=billing-alerts@example[dot]com

Optional SMTP settings for email delivery:

- SMTP_HOST=smtp.example.com
- SMTP_PORT=587
- SMTP_USER=...
- SMTP_PASS=...

Alert thresholds (defaults shown):

- BILLING_ALERT_WEBHOOK_5XX_THRESHOLD=3
- BILLING_ALERT_WEBHOOK_5XX_WINDOW_SEC=600
- BILLING_ALERT_WEBHOOK_4XX_THRESHOLD=5
- BILLING_ALERT_WEBHOOK_4XX_WINDOW_SEC=900
- BILLING_ALERT_WEBHOOK_CONSECUTIVE_FAILURES=3
- BILLING_ALERT_COOLDOWN_SEC=600

Health-check alert settings:

- BILLING_HEALTHCHECK_URL=<https://billing-webhook-production.up.railway.app/health>
- BILLING_HEALTH_ALERT_CONSECUTIVE_FAILURES=2
- BILLING_HEALTH_ALERT_STATE_PATH=data/billing-health-alert-state.json

Operational commands:

- npm run billing:health-alert
- npm run billing:daily-summary

### Failure drill: jobs stuck in `inprogress/`

Symptoms:

- `/health` shows `counts.inprogress > 0`
- `/health` shows `workerRunning = false`

Action:

1. Restart the worker with `node scripts/billingWebhook.js`.
2. Confirm startup recovery moves files from `inprogress/` back to `jobs/`.
3. If the same file sticks again, inspect the job JSON for a bad `intakePath` or exhausted retries.
4. Review `attemptHistory`, `lastAttemptAt`, and `lastExitCode` in the recovered job file.

### Failure drill: `failed/` has files

Symptoms:

- `/health` shows `counts.failed > 0`

Action:

1. Inspect the newest failed job file in `outputs/billing-queue/failed/`.
2. Fix the root cause before requeueing: intake provenance mismatch, missing archive credentials, or upstream audit failure.
3. Requeue manually by moving the JSON back to `outputs/billing-queue/jobs/`.
4. Reset `attempts` only if you are intentionally retrying after fixing the underlying issue.

## QA Checklist

- [ ] Command completed successfully.
- [ ] `report.html` opens and major sections render.
- [ ] `manifest.json` includes block number/hash and evidence paths.
- [ ] Archive-partial warning appears when non-archive RPC is used.
- [ ] ZIP exists and has non-trivial size.
- [ ] Run `npm run delivery:prep -- --bundle <bundle-folder-or-zip>` and review outputs.

## Delivery Prep

```powershell
npm run delivery:prep -- --bundle outputs/bundles/<bundle-folder>
```

Outputs:

- `outputs/delivery/SHA256SUMS.txt`
- `outputs/delivery/delivery-email.txt`

## Demo Asset Refresh

```powershell
npm run capture:setup
npm run demo:refresh
```

Optional demo freeze:

- Add `docs/demo/DEMO_BUNDLE_OVERRIDE.txt` with a specific bundle folder.

## Troubleshooting

### Non-archive RPC partial security

- Symptom: report shows partial-history warning.
- Action: rerun with archive-capable endpoint when pinned historical completeness is required.

### Strict preflight fails for archive policy

- Symptom: strict mode blocks pinned-block target.
- Action: provide archive-capable RPC or rerun preflight with `--allow-partial-security` for explicitly accepted partial outputs.

### RPC rate limits

- Symptom: long processing time or intermittent missing feed reads.
- Action: rerun with private RPC or reduced concurrency configuration.

### Metadata gaps

- Symptom: token metadata failures or `N/A` symbols.
- Action: add chain config overrides and rerun.

### Screenshot capture fails

- Symptom: Playwright launch error.
- Action: run `npm run capture:setup`; if still failing, capture manual screenshots from `report.html`.

## Escalation Policy

Escalate to archive RPC when:

- Client requested pinned-block historical completeness.
- Security appendix must be complete for governance/procurement review.
- Reproducibility concerns require strict historical parity.

## First Engagement Checklist

- [ ] Intake received with vault, chain, block, RPC, and client contact.
- [ ] SOW signed (or explicitly waived for small engagement).
- [ ] Invoice sent and confirmed.
- [ ] Run `npm run deliverable -- --mode auto --rpc <RPC> --block <BLOCK> --client <CLIENT> --engagement <ENGAGEMENT> --zip`.
- [ ] Confirm redaction is enabled (`--redact` in deliverable script).
- [ ] QA `report.html` and verify expected table sections.
- [ ] Run `npm run delivery:prep -- --bundle <bundle-folder-or-zip>`.
- [ ] Send `delivery-email.txt`, ZIP, and `SHA256SUMS.txt`.
- [ ] Retain bundle per policy window (30 days unless otherwise agreed).
