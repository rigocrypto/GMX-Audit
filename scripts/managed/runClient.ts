import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { randomUUID } from "crypto";

import { getClientConfig } from "../../config/clients";

type CliArgs = {
  clientId: string;
  chainsOverride?: string[];
  once: boolean;
  priceUsd?: string;
  packageLimit: number;
};

type RunStatus = "success" | "partial" | "failed";

type RunSummary = {
  clientId: string;
  timestamp: string;
  runId: string;
  status: RunStatus;
  rotationErrors: Array<{ chain: string; error: string }>;
  tier: string;
  chains: string[];
  chainRuns: Array<{
    chain: string;
    status: "ok" | "failed" | "skipped_missing_rpc";
    logPath: string;
    rpcEnvName?: string;
    message?: string;
    exitCode?: number;
  }>;
  triage: {
    totalProofs: number;
    hasCritical: boolean;
    hasHigh: boolean;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    ethPriceUsed?: string;
    ethPriceSource?: string;
  };
  artifacts: {
    runDir: string;
    triageResultPath: string;
    dashboardPath: string;
    dbPath: string;
    proofPackageDir?: string;
    reportDir?: string;
  };
};

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx !== -1 ? argv[idx + 1] : undefined;
  };

  const clientId = get("--client");
  if (!clientId) {
    throw new Error("Missing required --client <id>");
  }

  const chainsRaw = get("--chains");
  const chainsOverride = chainsRaw
    ? chainsRaw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : undefined;

  const once = argv.includes("--once");
  const priceUsd = get("--price");
  const packageLimit = Number(get("--package-limit") || "5");

  return {
    clientId,
    chainsOverride,
    once,
    priceUsd,
    packageLimit: Number.isFinite(packageLimit) && packageLimit > 0 ? packageLimit : 5
  };
}

function toIsoDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function toRunId(now = new Date()): string {
  return `${now.toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function validateClientEnv(
  client: ReturnType<typeof getClientConfig>,
  chains: string[]
): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];

  const rpcMissing = chains.filter((chain) => {
    const envName = resolveRpcEnvName(chain, client.env);
    return !envName || !process.env[envName];
  });

  if (rpcMissing.length === chains.length) {
    errors.push(
      `No RPC env vars are set for any configured chain (${chains.join(", ")}). ` +
        `Set e.g. ${(chains[0] ?? "CHAIN").toUpperCase()}_RPC_URL in your environment.`
    );
  } else if (rpcMissing.length > 0) {
    warnings.push(`Missing RPC env for chains: ${rpcMissing.join(", ")} — those chains will be skipped.`);
  }

  if (client.alerts.slackWebhookEnv && !process.env[client.alerts.slackWebhookEnv]) {
    warnings.push(`Slack webhook env "${client.alerts.slackWebhookEnv}" is not set — alerts will not be delivered.`);
  }

  if (client.auth.dashboardTokenEnv && !process.env[client.auth.dashboardTokenEnv]) {
    warnings.push(`Dashboard token env "${client.auth.dashboardTokenEnv}" is not set — dashboard auth will reject all requests.`);
  }

  return { warnings, errors };
}

function resolveRpcEnvName(chain: string, envMap: Record<string, string>): string | undefined {
  const upperChain = chain.toUpperCase();
  const candidates = [
    `${upperChain}_RPC_URL`,
    `${upperChain}_RPC`,
    `${chain}RpcEnv`,
    chain,
    "RPC_URL"
  ];

  for (const key of candidates) {
    if (envMap[key]) return envMap[key];
  }

  return undefined;
}

function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  logPath: string,
  cwd: string
): Promise<number> {
  return new Promise((resolve) => {
    const out = fs.createWriteStream(logPath, { flags: "a" });
    let settled = false;

    const safeWrite = (chunk: string | Buffer): void => {
      if (!out.writableEnded) {
        out.write(chunk);
      }
    };

    const finalize = (code: number): void => {
      if (settled) return;
      settled = true;
      safeWrite(`\n[exit] ${code}\n`);
      out.end();
      resolve(code);
    };

    safeWrite(`\n$ ${command} ${args.join(" ")}\n`);

    const child = spawn(command, args, {
      cwd,
      env,
      shell: false
    });

    child.stdout.on("data", (chunk) => safeWrite(chunk));
    child.stderr.on("data", (chunk) => safeWrite(chunk));

    child.on("close", (code) => {
      finalize(code ?? 0);
    });

    child.on("error", (error) => {
      safeWrite(`\n[spawn-error] ${(error as Error).message}\n`);
      finalize(1);
    });
  });
}

async function runRotationForChain(
  chain: string,
  rpcEnvName: string | undefined,
  runDir: string,
  priceUsd?: string
): Promise<RunSummary["chainRuns"][number]> {
  const logPath = path.join(runDir, `rotation-${chain}.log`);
  const env = { ...process.env };

  if (priceUsd) {
    env.ETH_PRICE_USD = priceUsd;
  }

  if (!rpcEnvName || !process.env[rpcEnvName]) {
    fs.writeFileSync(
      logPath,
      `[managed] skipped ${chain}: missing configured RPC env (${rpcEnvName || "undefined"})\n`,
      "utf8"
    );
    return {
      chain,
      status: "skipped_missing_rpc",
      logPath,
      rpcEnvName,
      message: "missing rpc env"
    };
  }

  const rpcValue = process.env[rpcEnvName] as string;
  env.GMX_CHAIN = chain;
  env.GMX_MANAGED_CHAIN = chain;
  env.RPC_URL = rpcValue;

  if (chain === "arbitrum") {
    env.ARBITRUM_RPC_URL = rpcValue;
  }
  if (chain === "avalanche") {
    env.AVALANCHE_RPC_URL = rpcValue;
    env.GMX_ALLOW_AVA_ORACLE_EXECUTE = "1";
  }

  const scriptPath = path.resolve(process.cwd(), "scripts", "rotateAndSearch.ps1");
  const isWindows = process.platform === "win32";
  const shell = isWindows ? "powershell" : "pwsh";
  const args = isWindows
    ? ["-ExecutionPolicy", "Bypass", "-File", scriptPath]
    : ["-File", scriptPath];

  const exitCode = await runCommand(shell, args, env, logPath, process.cwd());

  return {
    chain,
    status: exitCode === 0 ? "ok" : "failed",
    exitCode,
    logPath,
    rpcEnvName
  };
}

async function runManagedCommands(runDir: string, priceUsd?: string): Promise<void> {
  const cwd = process.cwd();
  const env = { ...process.env };
  if (priceUsd) {
    env.ETH_PRICE_USD = priceUsd;
  }

  const triageLog = path.join(runDir, "triage.log");
  await runCommand("npm", ["run", "triage:ci"], env, triageLog, cwd);

  const sourceTriage = path.join(cwd, "outputs", "triage", "triage-result.json");
  const targetTriage = path.join(runDir, "triage-result.json");
  if (fs.existsSync(sourceTriage)) {
    fs.copyFileSync(sourceTriage, targetTriage);
  }

  const dbPath = path.join(runDir, "results.db");
  const dashboardPath = path.join(runDir, "dashboard.html");
  const dashboardLog = path.join(runDir, "dashboard.log");
  await runCommand(
    "npm",
    ["run", "dashboard", "--", "--db", dbPath, "--out", dashboardPath],
    env,
    dashboardLog,
    cwd
  );
}

async function packageProofs(
  runDir: string,
  packageLimit: number,
  priceUsd?: string
): Promise<{ proofPackageDir?: string; reportDir?: string }> {
  const triagePath = path.join(runDir, "triage-result.json");
  if (!fs.existsSync(triagePath)) return {};

  const parsed = JSON.parse(fs.readFileSync(triagePath, "utf8")) as {
    proofs?: Array<{ file?: string }>;
  };

  const proofFiles = (parsed.proofs || [])
    .map((p) => p.file)
    .filter((name): name is string => Boolean(name))
    .slice(0, packageLimit);

  if (proofFiles.length === 0) return {};

  const cwd = process.cwd();
  const env = { ...process.env };
  if (priceUsd) {
    env.ETH_PRICE_USD = priceUsd;
  }

  const proofPackageDir = path.join(runDir, "proof-packages");
  const reportDir = path.join(runDir, "reports");
  ensureDir(proofPackageDir);
  ensureDir(reportDir);

  for (const proofFile of proofFiles) {
    const proofPath = path.join(cwd, "exploit-proofs", proofFile);
    if (!fs.existsSync(proofPath)) continue;

    const packageLog = path.join(runDir, `package-${proofFile.replace(/[^a-zA-Z0-9_.-]/g, "_")}.log`);
    await runCommand(
      "npm",
      ["run", "proof:package", "--", "--file", proofPath, "--outDir", proofPackageDir, "--price", priceUsd || "3400"],
      env,
      packageLog,
      cwd
    );

    const reportPath = path.join(reportDir, `${path.basename(proofFile, path.extname(proofFile))}.md`);
    const reportLog = path.join(runDir, `report-${proofFile.replace(/[^a-zA-Z0-9_.-]/g, "_")}.log`);
    await runCommand(
      "npm",
      ["run", "generate-immunefi", "--", "--file", proofPath, "--out", reportPath, "--price", priceUsd || "3400"],
      env,
      reportLog,
      cwd
    );
  }

  return { proofPackageDir, reportDir };
}

async function sendAlerts(summary: RunSummary, slackWebhookEnv?: string, emailTo?: string[]): Promise<void> {
  const alertsDir = path.join(summary.artifacts.runDir, "alerts");
  ensureDir(alertsDir);

  const subject = `[managed] ${summary.clientId}: proofs=${summary.triage.totalProofs} critical=${summary.triage.hasCritical}`;
  const body = JSON.stringify(summary, null, 2);

  if (slackWebhookEnv) {
    const webhook = process.env[slackWebhookEnv];
    if (webhook) {
      let lastStatus = 0;
      let delivered = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(webhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: `${subject}\n${summary.artifacts.runDir}` })
          });
          lastStatus = res.status;
          if (res.ok) { delivered = true; break; }
          console.warn(`[alert] Slack attempt ${attempt + 1} failed: ${res.status}`);
        } catch (err) {
          console.warn(`[alert] Slack attempt ${attempt + 1} error: ${(err as Error).message}`);
        }
        if (attempt < 2) await new Promise<void>((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
      if (delivered) {
        fs.writeFileSync(
          path.join(alertsDir, "slack.json"),
          JSON.stringify({ delivered: true, status: lastStatus }, null, 2),
          "utf8"
        );
      } else {
        const deadLetter = {
          timestamp: new Date().toISOString(),
          clientId: summary.clientId,
          runId: summary.runId,
          webhookEnvName: slackWebhookEnv,
          payload: { text: `${subject}\n${summary.artifacts.runDir}` },
          attempts: 3
        };
        fs.writeFileSync(
          path.join(alertsDir, "dead-letter.json"),
          JSON.stringify(deadLetter, null, 2),
          "utf8"
        );
        console.error("[alert] All Slack retries exhausted — alert written to dead-letter queue");
      }
    }
  }

  if (emailTo && emailTo.length > 0) {
    const sink = {
      to: emailTo,
      subject,
      body
    };
    fs.writeFileSync(path.join(alertsDir, "email-sink.json"), JSON.stringify(sink, null, 2), "utf8");
  }
}

function pruneOldRuns(clientDir: string, keepDays: number): void {
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  if (!fs.existsSync(clientDir)) return;
  for (const dateDir of fs.readdirSync(clientDir)) {
    const fullPath = path.join(clientDir, dateDir);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory() && stat.mtimeMs < cutoff) {
        fs.rmSync(fullPath, { recursive: true });
        console.log(`[prune] Removed old run dir: ${dateDir}`);
      }
    } catch {
      // skip unreadable entries
    }
  }
}

export async function executeClientRun(args: CliArgs): Promise<RunSummary> {
  const client = getClientConfig(args.clientId);
  const chains = args.chainsOverride && args.chainsOverride.length > 0 ? args.chainsOverride : client.chains;

  const { warnings: envWarnings, errors: envErrors } = validateClientEnv(client, chains);
  for (const w of envWarnings) console.warn(`[validate] ${w}`);
  if (envErrors.length > 0) {
    throw new Error(`[validate] Env validation failed:\n${envErrors.join("\n")}`);
  }

  const timestamp = new Date().toISOString();
  const runId = toRunId();
  const runDir = path.join(process.cwd(), "outputs", "managed", client.id, toIsoDate(), runId);
  ensureDir(runDir);

  const chainRuns: RunSummary["chainRuns"] = [];
  for (const chain of chains) {
    const rpcEnvName = resolveRpcEnvName(chain, client.env);
    // Reuse existing rotation script per chain via GMX_MANAGED_CHAIN.
    const result = await runRotationForChain(chain, rpcEnvName, runDir, args.priceUsd);
    chainRuns.push(result);
  }

  await runManagedCommands(runDir, args.priceUsd);
  const packaged = await packageProofs(runDir, args.packageLimit, args.priceUsd);

  const triagePath = path.join(runDir, "triage-result.json");
  const triage = fs.existsSync(triagePath)
    ? (JSON.parse(fs.readFileSync(triagePath, "utf8")) as {
        total_proofs?: number;
        has_critical?: boolean;
        has_high?: boolean;
        critical_count?: number;
        high_count?: number;
        medium_count?: number;
        eth_price_used?: string;
        eth_price_source?: string;
      })
    : {};

  const failedRuns = chainRuns.filter((r) => r.status === "failed");
  const ranRuns = chainRuns.filter((r) => r.status !== "skipped_missing_rpc");
  const runStatus: RunStatus =
    failedRuns.length === 0
      ? ranRuns.length > 0
        ? "success"
        : "failed"
      : failedRuns.length < ranRuns.length
        ? "partial"
        : "failed";
  const rotationErrors = failedRuns.map((r) => ({
    chain: r.chain,
    error: r.message ?? `exit ${r.exitCode ?? "?"}`
  }));

  const toRel = (abs: string) => path.relative(process.cwd(), abs).replace(/\\/g, "/");

  const summary: RunSummary = {
    clientId: client.id,
    timestamp,
    runId,
    status: runStatus,
    rotationErrors,
    tier: client.tiers,
    chains,
    chainRuns,
    triage: {
      totalProofs: Number(triage.total_proofs || 0),
      hasCritical: Boolean(triage.has_critical),
      hasHigh: Boolean(triage.has_high),
      criticalCount: Number(triage.critical_count || 0),
      highCount: Number(triage.high_count || 0),
      mediumCount: Number(triage.medium_count || 0),
      ethPriceUsed: triage.eth_price_used,
      ethPriceSource: triage.eth_price_source
    },
    artifacts: {
      runDir: toRel(runDir),
      triageResultPath: toRel(triagePath),
      dashboardPath: toRel(path.join(runDir, "dashboard.html")),
      dbPath: toRel(path.join(runDir, "results.db")),
      proofPackageDir: packaged.proofPackageDir ? toRel(packaged.proofPackageDir) : undefined,
      reportDir: packaged.reportDir ? toRel(packaged.reportDir) : undefined
    }
  };

  fs.writeFileSync(path.join(runDir, "run-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  await sendAlerts(summary, client.alerts.slackWebhookEnv, client.alerts.emailTo);

  pruneOldRuns(path.join(process.cwd(), "outputs", "managed", client.id), client.retentionDays ?? 30);

  return summary;
}

if (require.main === module) {
  const main = async (): Promise<void> => {
    const args = parseArgs(process.argv.slice(2));
    const summary = await executeClientRun(args);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  };

  main().catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}
