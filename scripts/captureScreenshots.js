const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

function parseArgs(argv) {
  const options = {
    bundle: null,
    outDir: path.resolve(process.cwd(), "docs/assets"),
    timeoutMs: 60000
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
      options.outDir = path.resolve(process.cwd(), argv[i + 1] || "docs/assets");
      i++;
      continue;
    }
    if (arg.startsWith("--out=")) {
      options.outDir = path.resolve(process.cwd(), arg.slice("--out=".length).trim());
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[i + 1] || 60000);
      i++;
      continue;
    }
    if (arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = Number(arg.slice("--timeout-ms=".length).trim());
      continue;
    }
  }

  return options;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function findFirstVisibleLocator(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      return locator;
    }
  }
  return null;
}

async function captureBundleScreens(options) {
  const bundleDir = path.resolve(process.cwd(), options.bundle);
  const reportPath = path.join(bundleDir, "report.html");

  if (!fs.existsSync(bundleDir)) {
    fail(`Bundle folder not found: ${bundleDir}`);
  }
  if (!fs.existsSync(reportPath)) {
    fail(`report.html not found in bundle: ${reportPath}`);
  }

  let playwright;
  try {
    playwright = require("playwright");
  } catch (_) {
    fail("Missing dependency 'playwright'. Run: npm install ; npm run capture:setup");
  }

  fs.mkdirSync(options.outDir, { recursive: true });

  const execPath = path.join(options.outDir, "sample-report-exec.png");
  const marketsPath = path.join(options.outDir, "sample-report-markets.png");

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (message.includes("Executable doesn't exist") || message.includes("browserType.launch")) {
      fail("Playwright browser is not installed. Run: npm run capture:setup");
    }
    throw error;
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 2200 } });
    const reportUrl = pathToFileURL(reportPath).href;

    await page.goto(reportUrl, {
      waitUntil: "networkidle",
      timeout: options.timeoutMs
    });

    await page.waitForSelector("h1", { timeout: options.timeoutMs });

    const execLocator = await findFirstVisibleLocator(page, [
      "#executive-summary",
      "#exec-summary",
      "text=Executive Summary",
      "h1"
    ]);

    if (execLocator) {
      await execLocator.scrollIntoViewIfNeeded();
      const box = await execLocator.boundingBox();
      if (box) {
        await page.screenshot({
          path: execPath,
          clip: {
            x: 0,
            y: Math.max(0, box.y - 80),
            width: 1600,
            height: 900
          }
        });
      } else {
        await page.screenshot({ path: execPath, fullPage: true });
      }
    } else {
      await page.screenshot({ path: execPath, fullPage: true });
    }

    const marketsLocator = await findFirstVisibleLocator(page, [
      "#markets-risk-table",
      "#v2-markets",
      "text=Markets Risk Summary",
      "text=V2 Markets",
      "text=Markets"
    ]);

    if (marketsLocator) {
      await marketsLocator.scrollIntoViewIfNeeded();
      const box = await marketsLocator.boundingBox();
      if (box) {
        await page.screenshot({
          path: marketsPath,
          clip: {
            x: 0,
            y: Math.max(0, box.y - 80),
            width: 1600,
            height: 1000
          }
        });
      } else {
        await page.screenshot({ path: marketsPath, fullPage: true });
      }
    } else {
      await page.screenshot({ path: marketsPath, fullPage: true });
    }

    process.stdout.write(`Wrote ${execPath}\n`);
    process.stdout.write(`Wrote ${marketsPath}\n`);
    return { execPath, marketsPath };
  } finally {
    await browser.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.bundle) {
    fail("Missing required --bundle argument.");
  }
  await captureBundleScreens(options);
}

if (require.main === module) {
  main().catch((error) => {
    fail(error && error.message ? error.message : String(error));
  });
}

module.exports = {
  captureBundleScreens
};