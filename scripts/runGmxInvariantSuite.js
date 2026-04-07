const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const specDir = path.join(process.cwd(), "test", "gmx-invariants");
const specFiles = fs
  .readdirSync(specDir)
  .filter((entry) => entry.endsWith(".spec.ts"))
  .sort()
  .map((entry) => path.posix.join("test", "gmx-invariants", entry));

if (specFiles.length === 0) {
  console.error("No invariant spec files found under test/gmx-invariants");
  process.exit(1);
}

const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(
  npxCmd,
  [
    "hardhat",
    "test",
    ...specFiles,
    "--network",
    "hardhat",
    "--show-stack-traces",
  ],
  {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      GMX_ENABLE_REAL_MUTATIONS: process.env.GMX_ENABLE_REAL_MUTATIONS || "true"
    }
  }
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
