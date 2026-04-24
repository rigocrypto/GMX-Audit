import fs from "fs";
import path from "path";

import { createBillingAlertNotifierFromEnv } from "./alerts";

type HealthState = {
  consecutiveFailures: number;
  lastStatus?: number;
  updatedAt: string;
};

function getStatePath(): string {
  const configured = process.env.BILLING_HEALTH_ALERT_STATE_PATH || path.join("data", "billing-health-alert-state.json");
  return path.resolve(process.cwd(), configured);
}

function readState(): HealthState {
  const statePath = getStatePath();
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw) as HealthState;
    return {
      consecutiveFailures:
        Number.isFinite(parsed.consecutiveFailures) && parsed.consecutiveFailures > 0 ? parsed.consecutiveFailures : 0,
      lastStatus: parsed.lastStatus,
      updatedAt: parsed.updatedAt || new Date().toISOString()
    };
  } catch {
    return { consecutiveFailures: 0, updatedAt: new Date().toISOString() };
  }
}

function writeState(state: HealthState): void {
  const statePath = getStatePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

async function main(): Promise<void> {
  const healthUrl =
    process.env.BILLING_HEALTHCHECK_URL || "https://billing-webhook-production.up.railway.app/health";
  const failureThreshold = Number.parseInt(process.env.BILLING_HEALTH_ALERT_CONSECUTIVE_FAILURES || "2", 10);
  const threshold = Number.isFinite(failureThreshold) && failureThreshold > 0 ? failureThreshold : 2;

  const notifier = createBillingAlertNotifierFromEnv();
  const state = readState();

  let status = 0;
  let ok = false;
  let body = "";

  try {
    const response = await fetch(healthUrl, { method: "GET" });
    status = response.status;
    body = await response.text();
    ok = response.ok;
  } catch (error) {
    status = 0;
    body = (error as Error).message;
    ok = false;
  }

  if (ok) {
    writeState({
      consecutiveFailures: 0,
      lastStatus: status,
      updatedAt: new Date().toISOString()
    });

    console.log(JSON.stringify({ ok: true, healthUrl, status }, null, 2));
    return;
  }

  const nextFailures = state.consecutiveFailures + 1;
  writeState({
    consecutiveFailures: nextFailures,
    lastStatus: status,
    updatedAt: new Date().toISOString()
  });

  if (nextFailures >= threshold) {
    await notifier({
      title: "Billing health check failed",
      level: "critical",
      source: "billing-health",
      message: "Health endpoint failed consecutive checks.",
      details: {
        healthUrl,
        status,
        consecutiveFailures: nextFailures,
        threshold,
        body: body.slice(0, 300)
      }
    });
  }

  console.error(
    JSON.stringify({ ok: false, healthUrl, status, consecutiveFailures: nextFailures, threshold }, null, 2)
  );
  process.exitCode = 1;
}

main().catch((error: Error) => {
  console.error("[billing:health-alert] failed", { error: error.message });
  process.exitCode = 1;
});