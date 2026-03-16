#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

const promPath = path.resolve("outputs", "metrics", "gmx_audit_batch.prom");
const csvPath = path.resolve("outputs", "metrics", "metrics.csv");

if (!fs.existsSync(promPath) || !fs.existsSync(csvPath)) {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  execFileSync(npmCmd, ["run", "metrics:export"], { stdio: "inherit" });
}

assert(fs.existsSync(promPath), ".prom file exists");
assert(fs.existsSync(csvPath), ".csv file exists");

if (fs.existsSync(promPath)) {
  const prom = fs.readFileSync(promPath, "utf8");
  assert(prom.includes("gmx_audit_batch_duration_ms"), ".prom contains batch_duration_ms");
  assert(prom.includes("gmx_audit_batch_passed"), ".prom contains batch_passed");
}

if (fs.existsSync(csvPath)) {
  const csv = fs.readFileSync(csvPath, "utf8");
  const lines = csv.trim().split(/\r?\n/);
  assert(lines.length >= 2, ".csv has header and at least one data row");
  assert(lines[0].includes("batchRoot"), ".csv header contains batchRoot");
}

if (process.exitCode === 1) {
  console.error("\nMetrics export test failed.");
  process.exit(1);
}

console.log("\nMetrics export test passed.");