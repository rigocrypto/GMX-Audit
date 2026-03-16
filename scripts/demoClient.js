#!/usr/bin/env node

const { spawnSync } = require("child_process");

const intakePath = process.env.DEMO_INTAKE || "docs/intake-template.json";
const archiveTarget = process.env.BATCH_ARCHIVE_TARGET;
const notifyEmail = process.env.BATCH_NOTIFY_EMAIL;

if (!archiveTarget) {
  console.error("BATCH_ARCHIVE_TARGET is required for demo-client.");
  process.exit(1);
}

if (!notifyEmail) {
  console.error("BATCH_NOTIFY_EMAIL is required for demo-client.");
  process.exit(1);
}

const args = [
  "run",
  "deliverable",
  "--",
  "--intake",
  intakePath,
  "--batch-preflight",
  "1",
  "--strict",
  "--batch-fail-fast",
  "--batch-archive",
  archiveTarget,
  "--batch-notify",
  notifyEmail
];

const run = spawnSync("npm", args, {
  stdio: "inherit",
  shell: process.platform === "win32"
});

process.exit(typeof run.status === "number" ? run.status : 1);
