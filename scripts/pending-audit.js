const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = process.cwd();
const outputFile = path.join(root, "outputs", "pending-audit.md");

function escapeMarkdownCell(value) {
  return String(value)
    .replace(/[\r\n\t]/g, " ")
    .replace(/\|/g, "\\|")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .slice(0, 240);
}

function classify(title) {
  const lower = title.toLowerCase();
  if (lower.includes("glv")) return "known_infra_or_chain_scope";
  if (lower.includes("subaccountrouter")) return "known_infra_or_chain_scope";
  if (lower.includes("executeorder") || lower.includes("withdrawal")) return "investigate";
  if (lower.includes("mint -> redeem glp")) return "intentional_pending";
  return "investigate";
}

function main() {
  const rawLogPath = path.join(root, "outputs", "pending-audit.raw.log");
  const outFd = fs.openSync(rawLogPath, "w");
  const errFd = fs.openSync(rawLogPath, "a");

  const result =
    process.platform === "win32"
      ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm run test:gmx-exploit-search:ava"], {
          shell: false,
          stdio: ["ignore", outFd, errFd],
        })
      : spawnSync("npm", ["run", "test:gmx-exploit-search:ava"], {
          shell: false,
          stdio: ["ignore", outFd, errFd],
        });

  fs.closeSync(outFd);
  fs.closeSync(errFd);

  const output = fs.readFileSync(rawLogPath, "utf8");

  if (result.error) {
    const errorLines = [
      "# Pending Test Audit (Avalanche)",
      "",
      `Runner error: ${result.error.message}`,
      "",
      "| Pending test | Classification |",
      "|---|---|",
      "| runner failed | investigate |",
    ];
    fs.writeFileSync(outputFile, `${errorLines.join("\n")}\n`);
    console.log("pending_count=0");
    return;
  }
  const testTitles = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^-\s+/, ""));

  const uniqueTitles = [...new Set(testTitles)];
  const lines = [
    "# Pending Test Audit (Avalanche)",
    "",
    `Exit code: ${result.status ?? "unknown"}`,
    `Detected pending tests: ${uniqueTitles.length}`,
    "",
    "| Pending test | Classification |",
    "|---|---|",
  ];

  for (const title of uniqueTitles) {
    lines.push(`| ${escapeMarkdownCell(title)} | ${escapeMarkdownCell(classify(title))} |`);
  }

  if (uniqueTitles.length === 0) {
    lines.push("| none detected | n/a |");
  }

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${lines.join("\n")}\n`);

  console.log(`pending_count=${uniqueTitles.length}`);
}

main();
