const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    bundle: null,
    outDir: path.resolve(process.cwd(), "outputs", "delivery")
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--bundle") {
      options.bundle = argv[i + 1] || null;
      i++;
      continue;
    }
    if (arg.startsWith("--bundle=")) {
      options.bundle = arg.slice("--bundle=".length).trim();
      continue;
    }
    if (arg === "--out") {
      options.outDir = path.resolve(process.cwd(), argv[i + 1] || "outputs/delivery");
      i++;
      continue;
    }
    if (arg.startsWith("--out=")) {
      options.outDir = path.resolve(process.cwd(), arg.slice("--out=".length).trim());
      continue;
    }
  }

  return options;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

function resolveBundleInput(bundleInput) {
  if (!bundleInput) {
    fail("Missing required --bundle argument.");
  }

  const absolute = path.resolve(process.cwd(), bundleInput);
  if (fs.existsSync(absolute)) {
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) {
      return {
        type: "dir",
        dir: absolute,
        zip: `${absolute}.zip`
      };
    }
    if (stat.isFile() && absolute.toLowerCase().endsWith(".zip")) {
      return {
        type: "zip",
        dir: absolute.slice(0, -4),
        zip: absolute
      };
    }
  }

  fail(`Bundle path not found: ${absolute}`);
}

function relativeSafe(value) {
  return String(value || "").replace(/\\/g, "/");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const bundle = resolveBundleInput(options.bundle);

  if (!fs.existsSync(bundle.zip)) {
    fail(`Zip not found for bundle: ${bundle.zip}`);
  }

  fs.mkdirSync(options.outDir, { recursive: true });

  const zipHash = sha256File(bundle.zip);
  const zipName = path.basename(bundle.zip);

  const hashFile = path.join(options.outDir, "SHA256SUMS.txt");
  const emailFile = path.join(options.outDir, "delivery-email.txt");

  const hashContent = `${zipHash}  ${zipName}\n`;
  fs.writeFileSync(hashFile, hashContent, "utf8");

  const emailContent = [
    "Subject: Delivery bundle ready",
    "",
    "Hi [Client],",
    "",
    "Your deliverable bundle is ready.",
    `- Bundle: ${relativeSafe(bundle.zip)}`,
    `- SHA256: ${zipHash}`,
    "",
    "Included artifacts:",
    `- ${relativeSafe(path.join(bundle.dir, "report.html"))}`,
    `- ${relativeSafe(path.join(bundle.dir, "report.md"))}`,
    `- ${relativeSafe(path.join(bundle.dir, "audit.csv"))}`,
    `- ${relativeSafe(path.join(bundle.dir, "audit.json"))}`,
    `- ${relativeSafe(path.join(bundle.dir, "manifest.json"))}`,
    "",
    "AI findings are advisory and require human validation.",
    "",
    "Rigo-Crypto"
  ].join("\n");

  fs.writeFileSync(emailFile, `${emailContent}\n`, "utf8");

  process.stdout.write(`Wrote ${hashFile}\n`);
  process.stdout.write(`Wrote ${emailFile}\n`);
}

main();
