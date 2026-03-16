const fs = require("fs");
const path = require("path");

const { captureBundleScreens } = require("./captureScreenshots");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function newestArbitrumBundle(bundlesDir) {
  if (!fs.existsSync(bundlesDir)) {
    return null;
  }

  const candidates = fs
    .readdirSync(bundlesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().includes("arbitrum"))
    .map((entry) => {
      const fullPath = path.join(bundlesDir, entry.name);
      const stat = fs.statSync(fullPath);
      return {
        name: entry.name,
        fullPath,
        mtimeMs: stat.mtimeMs
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return candidates[0] || null;
}

function resolveOverrideBundle(root, bundlesDir, demoDir) {
  const overridePath = path.join(demoDir, "DEMO_BUNDLE_OVERRIDE.txt");
  if (!fs.existsSync(overridePath)) {
    return null;
  }

  const raw = fs.readFileSync(overridePath, "utf8").trim();
  if (!raw) {
    return null;
  }

  const candidates = [
    path.isAbsolute(raw) ? raw : path.resolve(root, raw),
    path.join(bundlesDir, raw)
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return {
        name: path.basename(candidate),
        fullPath: candidate,
        source: "override"
      };
    }
  }

  fail(`DEMO_BUNDLE_OVERRIDE.txt points to a missing folder: ${raw}`);
}

async function main() {
  const root = process.cwd();
  const bundlesDir = path.join(root, "outputs", "bundles");
  const demoDir = path.join(root, "docs", "demo");
  const assetsDir = path.join(root, "docs", "assets");

  fs.mkdirSync(demoDir, { recursive: true });

  const selected = resolveOverrideBundle(root, bundlesDir, demoDir) || newestArbitrumBundle(bundlesDir);
  if (!selected) {
    fail("No Arbitrum bundle folder found under outputs/bundles.");
  }

  await captureBundleScreens({
    bundle: selected.fullPath,
    outDir: assetsDir,
    timeoutMs: 60000
  });

  const latestTxt = [
    `bundle=${selected.name}`,
    `selection=${selected.source || "latest-arbitrum"}`,
    `capturedAt=${new Date().toISOString()}`,
    `reportPath=${path.join(selected.fullPath, "report.html")}`
  ].join("\n");
  fs.writeFileSync(path.join(demoDir, "LATEST_BUNDLE.txt"), `${latestTxt}\n`, "utf8");

  process.stdout.write(`Refreshed demo assets from ${selected.name}\n`);
  process.stdout.write(`Metadata: docs/demo/LATEST_BUNDLE.txt\n`);
}

main().catch((error) => {
  fail(error && error.message ? error.message : String(error));
});