import fs from "fs";
import path from "path";

import { getClientConfig, listClientConfigs } from "../../config/clients";

type HealthStatus = "healthy" | "warning" | "error";

type ClientHealth = {
  clientId: string;
  status: HealthStatus;
  lastRunTimestamp?: string;
  lastRunStatus?: string;
  lastRunAgeHours?: number;
  reasons: string[];
};

type HealthReport = {
  timestamp: string;
  overall: HealthStatus;
  clients: ClientHealth[];
};

const REQUIRED_FIELDS = ["status", "timestamp", "clientId", "triage", "artifacts"] as const;

function findLatestSummary(clientId: string): Record<string, unknown> | null {
  const base = path.join(process.cwd(), "outputs", "managed", clientId);
  if (!fs.existsSync(base)) return null;

  for (const day of fs.readdirSync(base).sort().reverse()) {
    const dayDir = path.join(base, day);
    if (!fs.statSync(dayDir).isDirectory()) continue;
    for (const run of fs.readdirSync(dayDir).sort().reverse()) {
      const summaryPath = path.join(dayDir, run, "run-summary.json");
      if (fs.existsSync(summaryPath)) {
        try {
          return JSON.parse(fs.readFileSync(summaryPath, "utf8")) as Record<string, unknown>;
        } catch {
          // corrupt entry — try next run
        }
      }
    }
  }
  return null;
}

function checkClientHealth(clientId: string, maxAgeHours: number): ClientHealth {
  const reasons: string[] = [];
  const summary = findLatestSummary(clientId);

  if (!summary) {
    return { clientId, status: "error", reasons: ["no runs found"] };
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in summary)) reasons.push(`missing field: ${field}`);
  }

  const timestamp = typeof summary.timestamp === "string" ? summary.timestamp : undefined;
  let lastRunAgeHours: number | undefined;

  if (timestamp) {
    const ageMs = Date.now() - new Date(timestamp).getTime();
    lastRunAgeHours = Math.round((ageMs / (1000 * 60 * 60)) * 10) / 10;
    if (lastRunAgeHours > maxAgeHours) {
      reasons.push(`stale: last run ${lastRunAgeHours}h ago (threshold: ${maxAgeHours}h)`);
    }
  } else {
    reasons.push("missing or invalid timestamp");
  }

  const runStatus = typeof summary.status === "string" ? summary.status : undefined;
  if (runStatus === "failed") reasons.push("last run status: failed");
  else if (runStatus === "partial") reasons.push("last run status: partial (some chains failed)");

  let status: HealthStatus = "healthy";
  if (reasons.length > 0) {
    const isError = reasons.some(
      (r) =>
        r.startsWith("missing field") ||
        r === "no runs found" ||
        r.includes("status: failed")
    );
    status = isError ? "error" : "warning";
  }

  return {
    clientId,
    status,
    lastRunTimestamp: timestamp,
    lastRunStatus: runStatus,
    lastRunAgeHours,
    reasons
  };
}

function worstStatus(...statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes("error")) return "error";
  if (statuses.includes("warning")) return "warning";
  return "healthy";
}

function parseArgs(argv: string[]): { clientSelector: string; maxAgeHours: number; jsonOutput: boolean } {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx !== -1 ? argv[idx + 1] : undefined;
  };
  return {
    clientSelector: get("--client") || "all",
    maxAgeHours: Number(get("--max-age-hours") || "24"),
    jsonOutput: argv.includes("--json")
  };
}

async function main(): Promise<void> {
  const { clientSelector, maxAgeHours, jsonOutput } = parseArgs(process.argv.slice(2));

  const targets =
    clientSelector === "all"
      ? listClientConfigs().map((cfg) => cfg.id)
      : [clientSelector];

  const clients: ClientHealth[] = [];
  for (const clientId of targets) {
    try {
      getClientConfig(clientId);
    } catch {
      clients.push({ clientId, status: "error", reasons: ["config not found"] });
      continue;
    }
    clients.push(checkClientHealth(clientId, maxAgeHours));
  }

  const overall = worstStatus(...clients.map((c) => c.status));
  const report: HealthReport = { timestamp: new Date().toISOString(), overall, clients };

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(`[managed:health] ${report.timestamp} — overall: ${overall.toUpperCase()}`);
    for (const c of clients) {
      const icon = c.status === "healthy" ? "✓" : c.status === "warning" ? "⚠" : "✗";
      const age = c.lastRunAgeHours !== undefined ? ` (last run: ${c.lastRunAgeHours}h ago)` : "";
      console.log(`  ${icon} ${c.clientId}: ${c.status}${age}`);
      for (const r of c.reasons) console.log(`      → ${r}`);
    }
  }

  process.exit(overall === "healthy" ? 0 : overall === "warning" ? 1 : 2);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(2);
});
