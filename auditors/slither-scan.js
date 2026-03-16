const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const runSemgrepScan = require("./semgrep-scan");

function countHighFromSlither(jsonPath) {
  if (!fs.existsSync(jsonPath)) {
    return 0;
  }

  try {
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    const detectors = data.results && Array.isArray(data.results.detectors)
      ? data.results.detectors
      : [];

    return detectors.filter((detector) => {
      const impact = String(detector.impact || "").toLowerCase();
      return impact === "high";
    }).length;
  } catch (_) {
    return 0;
  }
}

module.exports = function runSlitherScan({ target, outputDir }) {
  const outputFile = path.join(outputDir, "slither.json");
  const stderrFile = path.join(outputDir, "slither.stderr.log");

  const result = spawnSync(
    "slither",
    [target, "--json", outputFile],
    { encoding: "utf8" }
  );

  if (result.error) {
    const semgrepResult = runSemgrepScan({ target, outputDir });
    if (semgrepResult.status !== "skipped") {
      return semgrepResult;
    }
    return {
      tool: "slither",
      status: "skipped",
      reason: "slither-not-installed",
      highCount: 0,
      fallback: semgrepResult
    };
  }

  if (result.status !== 0) {
    fs.writeFileSync(stderrFile, `${result.stderr || ""}\n${result.stdout || ""}`);
    return {
      tool: "slither",
      status: "error",
      reason: `slither-exit-${result.status}`,
      stderrFile,
      highCount: countHighFromSlither(outputFile)
    };
  }

  let version = "unknown";
  try {
    const versionResult = spawnSync("slither", ["--version"], { encoding: "utf8" });
    if (versionResult.status === 0 && versionResult.stdout) {
      version = versionResult.stdout.trim();
    }
  } catch (_) {
    // Keep version as unknown if probing fails.
  }

  return {
    tool: "slither",
    version,
    status: "ok",
    outputFile,
    highCount: countHighFromSlither(outputFile)
  };
};
