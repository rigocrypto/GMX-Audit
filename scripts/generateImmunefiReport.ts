import * as fs from "fs";
import * as path from "path";

import { computeSeverity } from "./validateProof";
import { weiToUSD } from "./utils/formatWei";

type Severity = "Critical" | "High" | "Medium";

type ProofTx = string | { hash?: string; to?: string; data?: string; desc?: string };

interface ProofJson {
  chain: string;
  block: number;
  detector: string;
  userNet: string;
  poolNet: string;
  description?: string;
  txs?: ProofTx[];
  env?: Record<string, string>;
  repro?: {
    command?: string;
    notes?: string;
  };
}

function formatImpactLine(raw: string, priceUSD: number | undefined, role: "attacker" | "pool"): string {
  if (!priceUSD || !Number.isFinite(priceUSD)) {
    return `${raw} wei`;
  }

  const conv = weiToUSD(raw, priceUSD);
  const roleText = role === "attacker" ? "extracted by attacker" : "drained from pool";
  const priceText = Number(priceUSD).toLocaleString("en-US", {
    style: "currency",
    currency: "USD"
  });
  return `${conv.usd} ${roleText} (${conv.eth} ETH @ ${priceText})`;
}

function severityBadge(sev: Severity): string {
  const badges: Record<Severity, string> = {
    Critical: "[CRITICAL]",
    High: "[HIGH]",
    Medium: "[MEDIUM]"
  };
  return badges[sev];
}

function renderTxLine(tx: ProofTx, index: number): string {
  if (typeof tx === "string") {
    return `${index + 1}. ${tx}`;
  }

  const pieces: string[] = [];
  if (tx.hash) pieces.push(`hash=${tx.hash}`);
  if (tx.to) pieces.push(`to=${tx.to}`);
  if (tx.desc) pieces.push(`desc=${tx.desc}`);
  if (tx.data) pieces.push(`data=${tx.data.slice(0, 42)}${tx.data.length > 42 ? "..." : ""}`);
  const details = pieces.length ? pieces.join(" | ") : "(empty tx object)";
  return `${index + 1}. ${details}`;
}

export function generateImmunefiReport(
  proof: ProofJson,
  opts: { priceUSD?: number; packageDir?: string } = {}
): string {
  const severity = computeSeverity({ userNet: proof.userNet, poolNet: proof.poolNet });
  const timestamp = new Date().toISOString();
  const chain = proof.chain.toUpperCase();

  const envVars: Record<string, string> = {
    GMX_CHAIN: proof.chain,
    FORK_BLOCK: String(proof.block),
    ...(proof.env || {})
  };

  const bashEnv = Object.entries(envVars)
    .map(([k, v]) => `export ${k}="${v}"`)
    .join("\n");

  const pwshEnv = Object.entries(envVars)
    .map(([k, v]) => `$env:${k} = "${v}"`)
    .join("\n");

  const testCmd = proof.repro?.command || `npx hardhat test --grep "${proof.detector}"`;

  const poolTVL = process.env.POOL_TVL_USD ? Number(process.env.POOL_TVL_USD) : undefined;

  const userNetFormatted = formatImpactLine(proof.userNet, opts.priceUSD, "attacker");
  const poolNetFormatted = formatImpactLine(proof.poolNet, opts.priceUSD, "pool");

  let tvlLine = "";
  if (poolTVL && opts.priceUSD) {
    const poolEth = Number(BigInt(proof.poolNet)) / 1e18;
    const poolUSD = Math.abs(poolEth * opts.priceUSD);
    const pct = ((poolUSD / poolTVL) * 100).toFixed(2);
    tvlLine = `\n- % of Pool TVL affected: ${pct}% (TVL reference: $${poolTVL.toLocaleString()})`;
  }

  const txBlock = proof.txs?.length
    ? proof.txs.map((tx, i) => renderTxLine(tx, i)).join("\n")
    : "No on-chain transactions captured in this proof (fork-only reproduction).";

  let attachments =
    "- proof.json - raw proof data\n- summary.json - parsed summary\n- env.txt - environment snapshot";
  if (opts.packageDir) {
    try {
      const files = fs
        .readdirSync(opts.packageDir)
        .filter((f) => f !== "immunefi-report.md")
        .map((f) => `- ${f}`)
        .join("\n");
      attachments = files || attachments;
    } catch {
      // Ignore listing errors and keep default attachments list.
    }
  }

  return `# Bug Report - ${proof.detector}

Severity: ${severityBadge(severity)}
Chain: ${chain}
Block: ${proof.block}
Generated: ${timestamp}

## Executive Summary

A vulnerability was detected in the ${proof.detector} invariant monitor while scanning ${chain} at block ${proof.block}.
${proof.description ? `\n${proof.description}\n` : ""}
The exploit results in a reproducible economic imbalance where the attacking account gains value while the liquidity pool loses a corresponding amount.

## Technical Impact

- Severity: ${severity}
- userNet: ${userNetFormatted}
- poolNet: ${poolNetFormatted}
- Chain: ${chain}
- Block (fork point): ${proof.block}${tvlLine}

userNet > 0 means attacker value extraction. poolNet < 0 means pool loss.

## Systems Affected

- Protocol: GMX v2
- Chain: ${chain}
- Fork block: ${proof.block}
- Detector invariant: ${proof.detector}
${proof.env ? `- Additional context: ${JSON.stringify(proof.env)}` : ""}

## Steps to Reproduce

Prerequisites:
- Node.js >= 18
- Archive RPC endpoint for ${chain}
- Repository: gmx-audit with dependencies installed

### Bash / Linux / macOS

\`\`\`bash
${bashEnv}
${testCmd}
\`\`\`

### PowerShell / Windows

\`\`\`powershell
${pwshEnv}
${testCmd}
\`\`\`

## Proof of Concept

### Transactions
${txBlock}

### Invariant Failure
The suite asserts userNet == 0 and poolNet == 0 after each sequence.
At block ${proof.block} this assertion fails with the values above.

## Expected vs Actual

- Expected userNet: 0
- Actual userNet: ${proof.userNet}
- Expected poolNet: 0
- Actual poolNet: ${proof.poolNet}

## Suggested Mitigation

1. Identify the exact execution path triggered at block ${proof.block}.
2. Add or tighten validation and accounting guardrails on affected entrypoints.
3. Keep userNet == 0 && poolNet == 0 as a regression invariant.
4. Re-run full invariants and exploit suites on patched code.

## Attachments

${attachments}

Report auto-generated by gmx-audit invariant harness.
`;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const fIdx = args.indexOf("--file");
  const oIdx = args.indexOf("--out");
  const pIdx = args.indexOf("--price");

  if (fIdx === -1 || !args[fIdx + 1]) {
    console.error(
      "Usage: ts-node scripts/generateImmunefiReport.ts --file <proof.json> [--out report.md] [--price <ethUSD>]"
    );
    process.exit(2);
  }

  const filePath = path.resolve(process.cwd(), args[fIdx + 1]);
  const outPath = oIdx !== -1 ? args[oIdx + 1] : undefined;
  const priceUSD = pIdx !== -1 ? Number(args[pIdx + 1]) : undefined;

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(2);
  }

  const proof = JSON.parse(fs.readFileSync(filePath, "utf8")) as ProofJson;
  const report = generateImmunefiReport(proof, { priceUSD });

  if (outPath) {
    const finalOutPath = path.resolve(process.cwd(), outPath);
    fs.mkdirSync(path.dirname(finalOutPath), { recursive: true });
    fs.writeFileSync(finalOutPath, report, "utf8");
    console.log(`Report written -> ${finalOutPath}`);
  } else {
    process.stdout.write(report);
  }
}
