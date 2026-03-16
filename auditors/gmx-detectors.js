const fs = require("fs");
const path = require("path");

module.exports = function runGmxDetectors({ bytecode, outputDir }) {
  const findings = [];

  if (!bytecode || bytecode === "0x") {
    findings.push({
      severity: "high",
      id: "GMX-NO-CODE",
      title: "Target address has no deployed bytecode"
    });
  }

  if (bytecode && bytecode.length > 2 && bytecode.length < 10000) {
    findings.push({
      severity: "medium",
      id: "GMX-SHORT-BYTECODE",
      title: "Bytecode length is unusually small for a production vault"
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    findings
  };

  const outputFile = path.join(outputDir, "gmx-risks.json");
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const highCount = findings.filter((item) => item.severity === "high").length;

  return {
    status: "ok",
    outputFile,
    highCount
  };
};
