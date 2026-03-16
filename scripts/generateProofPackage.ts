import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import { generateImmunefiReport } from "./generateImmunefiReport";
import { computeSeverity } from "./validateProof";

interface ProofJson {
  chain: string;
  block: number;
  detector: string;
  userNet: string;
  poolNet: string;
  description?: string;
  txs?: (string | { hash?: string; to?: string; data?: string; desc?: string })[];
  env?: Record<string, string>;
  repro?: { command?: string; notes?: string };
}

function sha256Short(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 8);
}

function buildFolderName(proof: ProofJson, hash: string): string {
  const det = proof.detector.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  return `${proof.chain}-${proof.block}-${det}-${hash}`;
}

export function generateProofPackage(
  proofPath: string,
  outDir: string,
  opts: { priceUSD?: number } = {}
): string {
  const raw = fs.readFileSync(proofPath, "utf8");
  const proof = JSON.parse(raw) as ProofJson;
  const hash = sha256Short(raw);
  const folderName = buildFolderName(proof, hash);
  const pkgDir = path.join(outDir, folderName);

  fs.mkdirSync(pkgDir, { recursive: true });

  fs.copyFileSync(proofPath, path.join(pkgDir, "proof.json"));

  const severity = computeSeverity({ userNet: proof.userNet, poolNet: proof.poolNet });
  const summary = {
    hash,
    severity,
    detector: proof.detector,
    chain: proof.chain,
    block: proof.block,
    userNet: proof.userNet,
    poolNet: proof.poolNet,
    timestamp: new Date().toISOString()
  };
  fs.writeFileSync(path.join(pkgDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

  const envVars: Record<string, string> = {
    GMX_CHAIN: proof.chain,
    FORK_BLOCK: String(proof.block),
    ...(proof.env || {})
  };
  const envTxt = Object.entries(envVars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  fs.writeFileSync(path.join(pkgDir, "env.txt"), envTxt, "utf8");

  const testCmd = proof.repro?.command || `npx hardhat test --grep "${proof.detector}"`;

  const bashExports = Object.entries(envVars)
    .map(([k, v]) => `export ${k}="${v}"`)
    .join("\n");
  const reproSh = `#!/usr/bin/env bash
# Reproduction script - ${proof.detector}
# Chain: ${proof.chain} | Block: ${proof.block} | Severity: ${severity}
set -euo pipefail

${bashExports}

echo "Running: ${testCmd}"
${testCmd}
`;
  fs.writeFileSync(path.join(pkgDir, "repro.sh"), reproSh, "utf8");
  try {
    fs.chmodSync(path.join(pkgDir, "repro.sh"), 0o755);
  } catch {
    // Ignore chmod errors on non-posix environments.
  }

  const pwshExports = Object.entries(envVars)
    .map(([k, v]) => `$env:${k} = "${v}"`)
    .join("\n");
  const reproPs1 = `# Reproduction script - ${proof.detector}
# Chain: ${proof.chain} | Block: ${proof.block} | Severity: ${severity}
$ErrorActionPreference = 'Stop'

${pwshExports}

Write-Host "Running: ${testCmd}"
${testCmd}
`;
  fs.writeFileSync(path.join(pkgDir, "repro.ps1"), reproPs1, "utf8");

  const report = generateImmunefiReport(proof, {
    priceUSD: opts.priceUSD,
    packageDir: pkgDir
  });
  fs.writeFileSync(path.join(pkgDir, "immunefi-report.md"), report, "utf8");

  return pkgDir;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const fIdx = args.indexOf("--file");
  const oIdx = args.indexOf("--outDir");
  const pIdx = args.indexOf("--price");

  if (fIdx === -1 || !args[fIdx + 1]) {
    console.error(
      "Usage: ts-node scripts/generateProofPackage.ts --file <proof.json> [--outDir proof-packages] [--price <ethUSD>]"
    );
    process.exit(2);
  }

  const proofPath = path.resolve(process.cwd(), args[fIdx + 1]);
  const outDir = oIdx !== -1 && args[oIdx + 1] ? args[oIdx + 1] : "proof-packages";
  const priceUSD = pIdx !== -1 ? Number(args[pIdx + 1]) : undefined;

  if (!fs.existsSync(proofPath)) {
    console.error(`File not found: ${proofPath}`);
    process.exit(2);
  }

  const pkgDir = generateProofPackage(proofPath, outDir, { priceUSD });

  console.log(`Package written -> ${pkgDir}`);
  console.log("Contents:");
  fs.readdirSync(pkgDir).forEach((f) => console.log(`  ${f}`));
}
