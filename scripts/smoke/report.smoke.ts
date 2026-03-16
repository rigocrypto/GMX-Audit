import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gmx-report-"));
const proofPath = path.join(tmpDir, "proof.json");
const reportPath = path.join(tmpDir, "report.md");

try {
  fs.writeFileSync(
    proofPath,
    JSON.stringify(
      {
        chain: "arbitrum",
        block: 420000000,
        detector: "GoldenFileTestDetector",
        userNet: "8500000000000000000",
        poolNet: "-8500000000000000000",
        txs: ["tx-1"]
      },
      null,
      2
    ),
    "utf8"
  );

  execSync(
    `npx ts-node scripts/generateImmunefiReport.ts --file "${proofPath}" --out "${reportPath}" --price 3400`,
    { stdio: "pipe" }
  );

  const report = fs.readFileSync(reportPath, "utf8");

  assert.ok(report.includes("## Executive Summary"), "missing Executive Summary section");
  assert.ok(report.includes("## Technical Impact"), "missing Technical Impact section");
  assert.ok(report.includes("## Steps to Reproduce"), "missing Steps to Reproduce section");
  assert.ok(report.includes("## Expected vs Actual"), "missing Expected vs Actual section");
  assert.ok(report.includes("[CRITICAL]") || report.includes("[HIGH]") || report.includes("[MEDIUM]"), "missing severity badge");
  assert.ok(report.includes("extracted by attacker"), "missing attacker directional text");
  assert.ok(report.includes("drained from pool"), "missing pool directional text");
  assert.ok(report.includes("ETH @") || report.includes("eth_price") || report.includes("price:"), "missing ETH price basis in report");

  const plusCount = (report.match(/\+\$/g) ?? []).length;
  const minusCount = (report.match(/-\$/g) ?? []).length;
  assert.ok(plusCount >= 1, "report missing +$ sign (userNet extracted)");
  assert.ok(minusCount >= 1, "report missing -$ sign (poolNet drained)");

  console.log("Report smoke test passed");
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
