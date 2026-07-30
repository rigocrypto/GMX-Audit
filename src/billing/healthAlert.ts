import {
  createBillingAlertNotifierFromEnv,
  listConfiguredAlertChannels
} from "./alerts";
import {
  ensureIncidentOpen,
  githubContextFromEnv,
  resolveIncident,
  type IncidentDetail
} from "./incidentIssue";

/**
 * Billing webhook health probe (secondary / backup detector).
 *
 * The PRIMARY outage detector is an external uptime monitor (see
 * docs/billing-monitoring.md). This job is the deduplicated backup path:
 *
 *   detect  -> probe /health `probes` times in-run; only a fully consecutive
 *              failure counts (avoids flapping on a single transient blip and
 *              needs no cross-run state on ephemeral CI runners).
 *   notify  -> push channels (webhook/email) AND a deduplicated GitHub issue.
 *   dedupe  -> one incident issue per outage, not one per failed run.
 *   escalate-> single escalation once the outage passes the time threshold.
 *   recover -> close the incident issue + send a recovery notification.
 *
 * A startup config check loudly warns when NO notification channel is wired up,
 * so the job can never look operational while having nowhere to send alerts.
 */

type ProbeResult = { ok: boolean; status: number; body: string };

function intFromEnv(name: string, fallback: number, min = 0): number {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function probeOnce(healthUrl: string, timeoutMs: number): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(healthUrl, { method: "GET", signal: controller.signal });
    const body = await response.text();
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, body: (error as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe until a success is seen or `probes` consecutive failures accumulate.
 * Returns the last probe result plus how many consecutive failures occurred.
 */
export async function probeHealth(
  healthUrl: string,
  probes: number,
  gapMs: number,
  timeoutMs: number
): Promise<{ ok: boolean; last: ProbeResult; failures: number }> {
  let last: ProbeResult = { ok: false, status: 0, body: "no probe executed" };
  let failures = 0;

  for (let attempt = 0; attempt < probes; attempt += 1) {
    last = await probeOnce(healthUrl, timeoutMs);
    if (last.ok) {
      return { ok: true, last, failures };
    }
    failures += 1;
    if (attempt < probes - 1 && gapMs > 0) {
      await sleep(gapMs);
    }
  }

  return { ok: false, last, failures };
}

/** Loudly report which notification channels are wired up; warn if none. */
export function reportChannelConfig(): { channels: string[]; hasAnyChannel: boolean } {
  const pushChannels = listConfiguredAlertChannels();
  const githubIssue = githubContextFromEnv() !== null;
  const channels = [...pushChannels, ...(githubIssue ? ["github-issue"] : [])];

  if (channels.length === 0) {
    console.error(
      "::warning::[billing:health-alert] NO notification channel is configured. " +
        "An outage will only appear as a failed job. Configure at least one of: " +
        "BILLING_ALERT_WEBHOOK_URL (Slack/Discord), SMTP_* + BILLING_ALERT_EMAIL_TO/FROM (email), " +
        "or run in GitHub Actions with GITHUB_TOKEN + issues:write (deduplicated incident issue)."
    );
  } else {
    console.log(`[billing:health-alert] notification channels: ${channels.join(", ")}`);
  }

  return { channels, hasAnyChannel: channels.length > 0 };
}

export async function runHealthAlert(): Promise<void> {
  const healthUrl =
    process.env.BILLING_HEALTHCHECK_URL?.trim() || "https://billing-webhook-production.up.railway.app/health";
  // Number of consecutive in-run probes that must all fail before we declare an outage.
  const probes = intFromEnv("BILLING_HEALTH_ALERT_PROBES", 2, 1) || 1;
  const gapMs = intFromEnv("BILLING_HEALTH_ALERT_PROBE_GAP_MS", 15000, 0);
  const timeoutMs = intFromEnv("BILLING_HEALTH_ALERT_TIMEOUT_MS", 10000, 1) || 10000;
  const escalateAfterMinutes = intFromEnv("BILLING_HEALTH_ESCALATE_AFTER_MIN", 20, 1) || 20;

  reportChannelConfig();

  const notifier = createBillingAlertNotifierFromEnv();
  const github = githubContextFromEnv();

  const { ok, last, failures } = await probeHealth(healthUrl, probes, gapMs, timeoutMs);
  // NOTE: `detail` feeds PUBLIC GitHub issue bodies — keep it to sanitized
  // operational facts only (no response body / exception text). The private
  // webhook/email notifier below may include richer detail.
  const detail: IncidentDetail = {
    healthUrl,
    status: last.status,
    probes: ok ? 0 : failures
  };

  if (ok) {
    // Healthy: if an incident was open, this is a recovery — close it and notify.
    let recovered = false;
    if (github) {
      try {
        const resolution = await resolveIncident(github, detail);
        recovered = resolution.action === "closed";
        if (recovered) {
          console.log(`[billing:health-alert] closed incident issue #${resolution.issueNumber}`);
        }
      } catch (error) {
        console.error("::warning::[billing:health-alert] failed to resolve incident issue", {
          error: (error as Error).message
        });
      }
    }

    if (recovered) {
      await notifier({
        title: "Billing health recovered",
        level: "info",
        source: "billing-health",
        message: "Health endpoint is responding again; incident closed.",
        details: { healthUrl, status: last.status }
      });
    }

    console.log(JSON.stringify({ ok: true, healthUrl, status: last.status, recovered }, null, 2));
    return;
  }

  // Confirmed outage (all `probes` consecutive probes failed).
  let issueAction = "skipped";
  if (github) {
    try {
      const result = await ensureIncidentOpen(github, detail, escalateAfterMinutes);
      issueAction = result.action;
      if (result.issueNumber) {
        console.log(`[billing:health-alert] incident issue #${result.issueNumber} (${result.action})`);
      }
    } catch (error) {
      console.error("::error::[billing:health-alert] failed to manage incident issue", {
        error: (error as Error).message
      });
    }
  }

  // Push a notification on a NEW or ESCALATED incident. Stay quiet on a plain
  // ongoing outage that is already tracked, to avoid one alert per run.
  const shouldPush = issueAction === "created" || issueAction === "escalated" || issueAction === "skipped";
  if (shouldPush) {
    await notifier({
      title: issueAction === "escalated" ? "Billing health STILL failing (escalation)" : "Billing health check failed",
      level: "critical",
      source: "billing-health",
      message: `Health endpoint failed ${failures} consecutive probe(s).`,
      details: {
        healthUrl,
        status: last.status,
        consecutiveFailures: failures,
        probes,
        incident: issueAction,
        body: last.body.slice(0, 300)
      }
    });
  }

  console.error(
    JSON.stringify(
      { ok: false, healthUrl, status: last.status, consecutiveFailures: failures, probes, incident: issueAction },
      null,
      2
    )
  );
  process.exitCode = 1;
}

// Only auto-run when invoked as a script, so tests can import the helpers safely.
if (require.main === module) {
  runHealthAlert().catch((error: Error) => {
    console.error("[billing:health-alert] failed", { error: error.message });
    process.exitCode = 1;
  });
}
