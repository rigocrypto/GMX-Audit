const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

module.exports = function runMythrilScan({ target, outputDir, rpcUrl }) {
  const outputFile = path.join(outputDir, "mythril.json");
  const stderrFile = path.join(outputDir, "mythril.stderr.log");

  const args = [
    "analyze",
    target,
    "--execution-timeout",
    "180",
    "-o",
    "json"
  ];

  if (rpcUrl) {
    args.push("--rpc", rpcUrl);
  }

  const result = spawnSync("myth", args, { encoding: "utf8" });

  if (result.error) {
    return {
      status: "skipped",
      reason: "mythril-not-installed"
    };
  }

  if (result.status !== 0) {
    fs.writeFileSync(stderrFile, `${result.stderr || ""}\n${result.stdout || ""}`);
    return {
      status: "error",
      reason: `mythril-exit-${result.status}`,
      stderrFile
    };
  }

  fs.writeFileSync(outputFile, result.stdout || "{}", "utf8");

  return {
    status: "ok",
    outputFile
  };
};
