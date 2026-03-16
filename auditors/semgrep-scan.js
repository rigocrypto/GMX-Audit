const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function runCommand(command, args) {
  return spawnSync(command, args, { encoding: "utf8", shell: false });
}

module.exports = function runSemgrepScan({ target, outputDir }) {
  const outputFile = path.join(outputDir, "semgrep.json");
  const stderrFile = path.join(outputDir, "semgrep.stderr.log");

  const semgrepArgs = [
    "-y",
    "@semgrep/cli",
    "semgrep",
    "--config",
    "p/smart-contracts",
    "--json",
    "--include",
    "*.sol",
    "--exclude",
    "test/",
    target,
  ];

  const result = runCommand("npx", semgrepArgs);

  if (result.error) {
    const skipped = {
      tool: "semgrep",
      status: "skipped",
      reason: "semgrep-cli-unavailable",
    };
    fs.writeFileSync(outputFile, JSON.stringify(skipped, null, 2));
    return skipped;
  }

  if (result.status !== 0 && !result.stdout) {
    fs.writeFileSync(stderrFile, `${result.stderr || ""}\n${result.stdout || ""}`);
    const errored = {
      tool: "semgrep",
      status: "error",
      reason: `semgrep-exit-${result.status}`,
      stderrFile,
    };
    fs.writeFileSync(outputFile, JSON.stringify(errored, null, 2));
    return errored;
  }

  try {
    const payload = JSON.parse(result.stdout || "{}");
    const findings = Array.isArray(payload.results) ? payload.results.length : 0;
    fs.writeFileSync(outputFile, JSON.stringify(payload, null, 2));

    return {
      tool: "semgrep",
      status: "ok",
      outputFile,
      findings,
    };
  } catch (_error) {
    fs.writeFileSync(stderrFile, `${result.stderr || ""}\n${result.stdout || ""}`);
    const parseError = {
      tool: "semgrep",
      status: "error",
      reason: "semgrep-json-parse-failed",
      stderrFile,
    };
    fs.writeFileSync(outputFile, JSON.stringify(parseError, null, 2));
    return parseError;
  }
};
