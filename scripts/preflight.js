const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { ethers } = require("ethers");

const CHAIN_CONFIG_DIR = path.resolve(process.cwd(), "configs/chains");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(stripped);
}

function parseArgs(argv) {
  const options = {
    intake: null,
    timeoutMs: 20000,
    strict: false,
    allowPartialSecurity: false,
    requireSecurity: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--intake") {
      options.intake = argv[i + 1] || null;
      i++;
      continue;
    }
    if (arg.startsWith("--intake=")) {
      options.intake = arg.slice("--intake=".length).trim();
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = Number(argv[i + 1] || 20000);
      i++;
      continue;
    }
    if (arg.startsWith("--timeout-ms=")) {
      options.timeoutMs = Number(arg.slice("--timeout-ms=".length).trim());
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--allow-partial-security") {
      options.allowPartialSecurity = true;
      continue;
    }
    if (arg === "--require-security") {
      options.requireSecurity = true;
      continue;
    }
  }

  if (!options.intake) {
    fail("Missing required --intake argument.");
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    fail("--timeout-ms must be a positive integer");
  }

  return options;
}

function toBlockTag(blockInput) {
  if (blockInput === undefined || blockInput === null || String(blockInput).toLowerCase() === "latest") {
    return "latest";
  }

  const parsed = Number(blockInput);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid block value: ${blockInput}`);
  }
  return parsed;
}

function hasChainConfig(chainId) {
  if (!fs.existsSync(CHAIN_CONFIG_DIR)) {
    return false;
  }

  const names = fs.readdirSync(CHAIN_CONFIG_DIR);
  return names.some((name) => name.startsWith(`${chainId}.`) && name.endsWith(".json"));
}

function makeProvider(rpcUrl, timeoutMs) {
  return new ethers.JsonRpcProvider(rpcUrl, undefined, {
    staticNetwork: null,
    polling: false,
    batchMaxCount: 1,
    cacheTimeout: 0,
    timeout: timeoutMs
  });
}

function formatLine(ok, text) {
  return `${ok ? "[PASS]" : "[FAIL]"} ${text}`;
}

function formatInfo(text) {
  return `[INFO] ${text}`;
}

function isArchiveError(error) {
  const msg = String(error && error.message ? error.message : error).toLowerCase();
  return msg.includes("missing trie node")
    || msg.includes("historical state")
    || msg.includes("state is not available")
    || msg.includes("header not found")
    || msg.includes("pruned");
}

function isRateLimitError(error) {
  const msg = String(error && error.message ? error.message : error).toLowerCase();
  return msg.includes("429")
    || msg.includes("-32005")
    || msg.includes("rate limit")
    || msg.includes("request rate exceeded");
}

function hasCommand(command, args = ["--version"]) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return !result.error;
}

function rpcGradeFromLatency(latencies, rateLimited) {
  if (!latencies.length) {
    return "C";
  }
  const avg = latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
  if (rateLimited) {
    return "C";
  }
  if (avg <= 400) {
    return "A";
  }
  if (avg <= 1200) {
    return "B";
  }
  return "C";
}

async function timed(fn) {
  const started = Date.now();
  const value = await fn();
  return {
    value,
    ms: Date.now() - started
  };
}

async function checkTarget(target, intake, options) {
  const result = {
    chainId: target.chainId,
    rpc: target.rpc,
    checks: [],
    ok: true
  };

  const push = (ok, message) => {
    result.checks.push(formatLine(ok, message));
    if (!ok) {
      result.ok = false;
    }
  };

  const info = (message) => {
    result.checks.push(formatInfo(message));
  };

  if (!target || typeof target !== "object") {
    push(false, "Target entry is not an object");
    return result;
  }

  if (!Number.isInteger(target.chainId) || target.chainId <= 0) {
    push(false, "chainId must be a positive integer");
    return result;
  }

  if (typeof target.rpc !== "string" || !target.rpc.startsWith("http")) {
    push(false, "rpc must be an http(s) URL");
    return result;
  }

  push(hasChainConfig(target.chainId), `chain config exists for ${target.chainId}`);

  let blockTag;
  try {
    blockTag = toBlockTag(target.block);
    push(true, `block value accepted (${blockTag})`);
  } catch (error) {
    push(false, error.message);
    return result;
  }

  const provider = makeProvider(target.rpc, options.timeoutMs);
  const latencies = [];
  let rateLimitObserved = false;
  const wantsSecurity = options.requireSecurity || Boolean(intake && intake.deliverables && intake.deliverables.security === true);
  let archiveProbeSucceeded = null;

  try {
    const networkProbe = await timed(() => provider.getNetwork());
    latencies.push(networkProbe.ms);
    const rpcChainId = Number(networkProbe.value.chainId);
    push(rpcChainId === target.chainId, `rpc chainId ${rpcChainId} matches intake chainId ${target.chainId}`);

    const latestProbe = await timed(() => provider.getBlock("latest"));
    latencies.push(latestProbe.ms);
    const latestBlock = latestProbe.value;
    push(Boolean(latestBlock && latestBlock.number >= 0), "rpc reachable and latest block query succeeded");

    try {
      const balanceProbe = await timed(() => provider.getBalance("0x000000000000000000000000000000000000dEaD", "latest"));
      latencies.push(balanceProbe.ms);
      push(balanceProbe.value !== null && balanceProbe.value !== undefined, "eth_call balance probe succeeded");
    } catch (error) {
      if (isRateLimitError(error)) {
        rateLimitObserved = true;
      }
      push(false, `eth_call balance probe failed: ${error.message || error}`);
    }

    if (blockTag !== "latest") {
      const pinned = await provider.getBlock(blockTag);
      push(Boolean(pinned && pinned.number === blockTag), `pinned block ${blockTag} is readable`);

      try {
        await provider.getBalance("0x000000000000000000000000000000000000dEaD", blockTag);
        push(true, `archive probe for block ${blockTag} succeeded`);
        archiveProbeSucceeded = true;
        if (intake.archiveRpcAvailable === false) {
          push(false, "intake declares archiveRpcAvailable=false but archive probe succeeded; verify intake data");
        }
      } catch (error) {
        archiveProbeSucceeded = false;
        if (isRateLimitError(error)) {
          rateLimitObserved = true;
        }
        if (isArchiveError(error)) {
          push(false, `archive probe failed for pinned block ${blockTag} (archive-capable RPC likely required)`);
        } else {
          push(false, `archive probe failed: ${error.message || error}`);
        }
      }

      if (options.strict && intake.archiveRpcAvailable === false) {
        push(false, "strict mode: pinned block requested while archiveRpcAvailable=false");
      }

      if (options.strict && wantsSecurity && !options.allowPartialSecurity && archiveProbeSucceeded !== true) {
        push(false, "strict mode: security deliverable with pinned block requires archive-capable RPC");
      }
    } else {
      push(true, "archive probe skipped (latest block mode)");
    }
  } catch (error) {
    if (isRateLimitError(error)) {
      rateLimitObserved = true;
    }
    push(false, `rpc check failed: ${error.message || error}`);
  }

  const grade = rpcGradeFromLatency(latencies, rateLimitObserved);
  const avgLatency = latencies.length
    ? (latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(0)
    : "n/a";
  info(`rpcGrade=${grade} avgLatencyMs=${avgLatency} rateLimitObserved=${rateLimitObserved}`);

  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const intakePath = path.resolve(process.cwd(), options.intake);

  if (!fs.existsSync(intakePath)) {
    fail(`Intake file not found: ${intakePath}`);
  }

  let intake;
  try {
    intake = readJsonFile(intakePath);
  } catch (error) {
    fail(`Failed to parse intake JSON: ${error.message || error}`);
  }

  if (!Array.isArray(intake.targets) || intake.targets.length === 0) {
    fail("Intake must include a non-empty targets array");
  }

  if (options.requireSecurity) {
    const slitherAvailable = hasCommand("slither", ["--version"]);
    const mythrilAvailable = hasCommand("myth", ["--version"]);
    if (!slitherAvailable || !mythrilAvailable) {
      fail("--require-security failed: slither and myth must be installed and accessible in PATH");
    }
  }

  const rows = [];
  let allOk = true;

  for (const target of intake.targets) {
    const row = await checkTarget(target, intake, options);
    rows.push(row);
    if (!row.ok) {
      allOk = false;
    }
  }

  process.stdout.write(`Preflight for client=${intake.client || "N/A"} engagement=${intake.engagement || "N/A"}\n`);
  process.stdout.write(`Targets: ${rows.length}\n\n`);

  for (const row of rows) {
    process.stdout.write(`Target chainId=${row.chainId} rpc=${row.rpc}\n`);
    for (const line of row.checks) {
      process.stdout.write(`  ${line}\n`);
    }
    process.stdout.write("\n");
  }

  if (!allOk) {
    process.stdout.write("Preflight result: FAILED\n");
    process.exit(1);
  }

  process.stdout.write("Preflight result: PASSED\n");
}

main().catch((error) => {
  fail(error && error.message ? error.message : String(error));
});
