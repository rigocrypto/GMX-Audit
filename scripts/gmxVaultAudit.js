const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const archiver = require("archiver");
const { ethers } = require("ethers");
require("dotenv").config();

const runSlitherScan = require("../auditors/slither-scan");
const runMythrilScan = require("../auditors/mythril-scan");
const runGmxDetectors = require("../auditors/gmx-detectors");
const { generateReports } = require("./vaultReport");

const VAULT_ABI = [
  "function allWhitelistedTokensLength() view returns (uint256)",
  "function allWhitelistedTokens(uint256) view returns (address)",
  "function whitelistedTokenCount() view returns (uint256)",
  "function whitelistedTokens(uint256) view returns (address)",
  "function poolAmounts(address) view returns (uint256)"
];

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)"
];

const ERC20_BYTES32_METADATA_ABI = [
  "function symbol() view returns (bytes32)",
  "function name() view returns (bytes32)"
];

const DATASTORE_VIEW_ABI = [
  "function getAddressCount(bytes32) view returns (uint256)"
];

const READER_V2_ABI = [
  "function getMarkets(address dataStore, uint256 start, uint256 end) view returns ((address marketToken,address indexToken,address longToken,address shortToken)[])"
];

const MARKET_LIST_SET_KEY = ethers.keccak256(
  ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["MARKET_LIST"])
);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const CHAINLINK_ABI = [
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function decimals() view returns (uint8)"
];

const STABLE_SYMBOLS = new Set(["USDC", "USDT", "DAI", "FRAX", "USDC.E", "USDT.E"]);

const ADDRESS_PRICE_FEEDS = {
  42161: {
    "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
    "0x2f2a2543b76a4166549f7aaab2e75bef0eaefc5b": "0x6ce185860a4963106506C203335A2910413708e9",
    "0xaf88d065e77c8cc2239327c5edb3a432268e5831": "0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3",
    "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": "0x3f3f5dF88dC9F13eac63DF89EC16ef6e7E25DdE7",
    "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1": "0xc5C8E77B397A1632dcdfD4dA5709E1e62f9bE167"
  },
  43114: {
    "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e": "0xF096872672F0bE9Dd7Ade7C1ac5A98574c8FfDC5",
    "0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7": "0x7898AcCC83587C3C55116c5230C17a6Cd9C71bad",
    "0xd586e7f844cea2f87f50152665bcbc2c279d8d70": "0x51D7180edA2260cc4F6e4EebB82FEF5c3c2B8300",
    "0x49d5c2bdffac6ce2bfdb6640f4f80f226bc10bab": "0x976B3D034E162d8bD72D6b9C989d545b839003b0",
    "0x50b7545627a5162f82a992c33b87adc75187b218": "0x2779D32d5166BAaa2A39B69a1B7a8084d97C9D03"
  }
};

const CHAIN_CONFIG_DIR = path.resolve(process.cwd(), "configs/chains");
const RPC_CALL_TIMEOUT_MS = Number(process.env.GMX_RPC_CALL_TIMEOUT_MS || 20000);
const REDACT_TEXT_EXTENSIONS = new Set([".json", ".md", ".txt", ".csv", ".html", ".log", ".yml", ".yaml"]);

function normalizeAddress(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    return null;
  }
  try {
    return ethers.getAddress(trimmed.toLowerCase());
  } catch (_) {
    return null;
  }
}

function isZeroAddress(value) {
  const normalized = normalizeAddress(value || "");
  return normalized ? normalized.toLowerCase() === ZERO_ADDRESS : false;
}

function getDisplayNetworkName(network, chainConfig, effectiveChainId) {
  if (chainConfig && chainConfig.name) {
    return String(chainConfig.name);
  }
  if (network && network.name && network.name !== "unknown") {
    return String(network.name);
  }
  return `chain-${effectiveChainId}`;
}

function formatFixedOrNA(value, digits) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "N/A";
}

function parseIntakePath(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--intake") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--intake requires a file path");
      }
      return next;
    }
    if (arg.startsWith("--intake=")) {
      const value = arg.slice("--intake=".length).trim();
      if (!value) {
        throw new Error("--intake requires a file path");
      }
      return value;
    }
  }
  return null;
}

function parseIntakeTargetIndex(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--intake-target-index") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--intake-target-index requires a non-negative integer");
      }
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("--intake-target-index must be a non-negative integer");
      }
      return parsed;
    }

    if (arg.startsWith("--intake-target-index=")) {
      const value = arg.slice("--intake-target-index=".length).trim();
      const parsed = Number(value);
      if (!value || !Number.isInteger(parsed) || parsed < 0) {
        throw new Error("--intake-target-index must be a non-negative integer");
      }
      return parsed;
    }
  }
  return null;
}

function parseBatchParallel(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--batch-parallel") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--batch-parallel requires a positive integer");
      }
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("--batch-parallel must be a positive integer");
      }
      return parsed;
    }

    if (arg.startsWith("--batch-parallel=")) {
      const value = arg.slice("--batch-parallel=".length).trim();
      const parsed = Number(value);
      if (!value || !Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("--batch-parallel must be a positive integer");
      }
      return parsed;
    }
  }
  return null;
}

function parseBatchRetry(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--batch-retry") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--batch-retry requires an integer >= 1");
      }
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error("--batch-retry must be an integer >= 1");
      }
      return parsed;
    }

    if (arg.startsWith("--batch-retry=")) {
      const value = arg.slice("--batch-retry=".length).trim();
      const parsed = Number(value);
      if (!value || !Number.isInteger(parsed) || parsed < 1) {
        throw new Error("--batch-retry must be an integer >= 1");
      }
      return parsed;
    }
  }
  return null;
}

function parseBatchRetryBackoffMs(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--batch-retry-backoff-ms") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--batch-retry-backoff-ms requires an integer >= 0");
      }
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("--batch-retry-backoff-ms must be an integer >= 0");
      }
      return parsed;
    }

    if (arg.startsWith("--batch-retry-backoff-ms=")) {
      const value = arg.slice("--batch-retry-backoff-ms=".length).trim();
      const parsed = Number(value);
      if (!value || !Number.isInteger(parsed) || parsed < 0) {
        throw new Error("--batch-retry-backoff-ms must be an integer >= 0");
      }
      return parsed;
    }
  }
  return null;
}

function parseBatchPreflight(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--batch-preflight") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        return true;
      }
      const value = String(next).trim();
      if (value !== "0" && value !== "1") {
        throw new Error("--batch-preflight must be 0 or 1");
      }
      return value === "1";
    }

    if (arg.startsWith("--batch-preflight=")) {
      const value = arg.slice("--batch-preflight=".length).trim();
      if (value !== "0" && value !== "1") {
        throw new Error("--batch-preflight must be 0 or 1");
      }
      return value === "1";
    }
  }

  return null;
}

function parseBatchArchive(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--batch-archive") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--batch-archive requires a value (s3://bucket[/prefix] or ipfs://pinata)");
      }
      return String(next).trim();
    }

    if (arg.startsWith("--batch-archive=")) {
      const value = arg.slice("--batch-archive=".length).trim();
      if (!value) {
        throw new Error("--batch-archive requires a value (s3://bucket[/prefix] or ipfs://pinata)");
      }
      return value;
    }
  }

  return null;
}

function parseBatchNotify(args) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--batch-notify") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--batch-notify requires an email address");
      }
      return String(next).trim();
    }

    if (arg.startsWith("--batch-notify=")) {
      const value = arg.slice("--batch-notify=".length).trim();
      if (!value) {
        throw new Error("--batch-notify requires an email address");
      }
      return value;
    }
  }

  return null;
}

function loadIntakeFile(filePath) {
  const resolved = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Intake file not found: ${resolved}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse intake JSON: ${error.message || error}`);
  }

  if (!Array.isArray(parsed.targets) || parsed.targets.length === 0) {
    throw new Error("Intake JSON must include a non-empty targets array");
  }

  return {
    path: resolved,
    doc: parsed,
    targets: parsed.targets,
    primaryTarget: parsed.targets[0],
    targetCount: parsed.targets.length
  };
}

function applyDeliverableLevel(options, level) {
  const normalized = String(level || "").toLowerCase();
  if (!normalized) {
    return;
  }

  if (!["lite", "standard", "full"].includes(normalized)) {
    throw new Error("intake deliverableLevel must be one of: lite, standard, full");
  }

  // All levels return report artifacts and packaging.
  options.bundle = true;
  options.zip = true;
  options.csv = true;
  options.json = true;
  options.reportHtml = options.reportHtml || true;
  options.reportMd = options.reportMd || true;
  options.usd = true;
  options.risk = true;

  if (normalized === "lite") {
    options.security = false;
    options.ai = false;
    return;
  }

  if (normalized === "standard") {
    options.security = false;
    options.ai = false;
    return;
  }

  // full
  options.security = true;
  options.ai = true;
}

function applyIntakeToOptions(options, intake) {
  const requestedTargetIndex = Number.isInteger(options.intakeTargetIndex)
    ? options.intakeTargetIndex
    : 0;
  if (requestedTargetIndex < 0 || requestedTargetIndex >= intake.targetCount) {
    throw new Error(
      `--intake-target-index ${requestedTargetIndex} is out of range (targets=${intake.targetCount})`
    );
  }

  const target = intake.targets[requestedTargetIndex] || intake.primaryTarget || {};

  options.intakePath = intake.path;
  options.intakeTargetCount = intake.targetCount;
  options.intakeResolvedTargetIndex = requestedTargetIndex;

  if (intake.doc.client) {
    options.client = String(intake.doc.client);
  }
  if (intake.doc.engagement) {
    options.engagement = String(intake.doc.engagement);
  }
  if (typeof intake.doc.archiveRpcAvailable === "boolean") {
    options.archiveRpcAvailable = intake.doc.archiveRpcAvailable;
  }

  if (target.rpc) {
    options.rpc = String(target.rpc);
  }
  if (target.mode) {
    options.mode = String(target.mode).toLowerCase();
  }
  if (target.block !== undefined && target.block !== null) {
    options.block = String(target.block);
  }
  if (Number.isInteger(target.chainId) && target.chainId > 0) {
    options.chainId = Number(target.chainId);
  }

  const maybeVault = normalizeAddress(target.vault || "");
  if (maybeVault) {
    options.vault = maybeVault;
  }

  const maybeDataStore = normalizeAddress(target.dataStore || "");
  if (maybeDataStore) {
    options.dataStore = maybeDataStore;
  }

  const maybeReader = normalizeAddress(target.reader || "");
  if (maybeReader) {
    options.reader = maybeReader;
  }

  const maybeV2Vault = normalizeAddress(target.v2Vault || "");
  if (maybeV2Vault) {
    options.v2Vault = maybeV2Vault;
  }

  if (intake.doc.deliverableLevel) {
    applyDeliverableLevel(options, intake.doc.deliverableLevel);
  }

  if (intake.doc.deliverables && typeof intake.doc.deliverables === "object") {
    if (typeof intake.doc.deliverables.ai === "boolean") {
      options.ai = intake.doc.deliverables.ai;
    }
    if (typeof intake.doc.deliverables.security === "boolean") {
      options.security = intake.doc.deliverables.security;
    }
  }

  if (intake.doc.batch && typeof intake.doc.batch === "object") {
    if (intake.doc.batch.failFast === true) {
      options.batchFailFast = true;
      options.batchContinueOnError = false;
    }
    if (intake.doc.batch.continueOnError === true) {
      options.batchContinueOnError = true;
      options.batchFailFast = false;
    }
    if (Number.isInteger(intake.doc.batch.retry) && intake.doc.batch.retry >= 1) {
      options.batchRetry = intake.doc.batch.retry;
    }
    if (Number.isInteger(intake.doc.batch.retryBackoffMs) && intake.doc.batch.retryBackoffMs >= 0) {
      options.batchRetryBackoffMs = intake.doc.batch.retryBackoffMs;
    }
    if (typeof intake.doc.batch.preflight === "boolean") {
      options.batchPreflight = intake.doc.batch.preflight;
    }
  }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const envVault = normalizeAddress(process.env.GMX_VAULT_ADDRESS || "");
  const options = {
    vault: envVault,
    rpc: process.env.GMX_RPC_URL || process.env.ARBITRUM_RPC_URL || "http://127.0.0.1:8545",
    block: process.env.GMX_AUDIT_BLOCK || "latest",
    usd: false,
    risk: false,
    riskSummary: false,
    csv: false,
    json: false,
    security: false,
    ai: false,
    aiUrl: process.env.GMX_AI_URL || "http://localhost:11434",
    aiModel: process.env.GMX_AI_MODEL || "qwen2.5-coder:7b",
    failOnAiHigh: process.env.GMX_FAIL_ON_AI_HIGH === "true",
    full: false,
    reportHtml: false,
    bundle: false,
    reportMd: false,
    preview: 25,
    maxStaleSeconds: Number(process.env.GMX_PRICE_MAX_STALE_SECONDS || 86400),
    failOnHigh: process.env.GMX_FAIL_ON_HIGH ? process.env.GMX_FAIL_ON_HIGH !== "false" : true,
    failOnMediumCount: process.env.GMX_FAIL_ON_MEDIUM_COUNT ? Number(process.env.GMX_FAIL_ON_MEDIUM_COUNT) : null,
    failOnSecuritySkip: process.env.GMX_FAIL_ON_SECURITY_SKIP ? process.env.GMX_FAIL_ON_SECURITY_SKIP !== "false" : false,
    requireSecurity: process.env.GMX_REQUIRE_SECURITY ? process.env.GMX_REQUIRE_SECURITY !== "false" : false,
    requireBlock: process.env.GMX_REQUIRE_BLOCK ? process.env.GMX_REQUIRE_BLOCK !== "false" : false,
    requireArchive: process.env.GMX_REQUIRE_ARCHIVE ? process.env.GMX_REQUIRE_ARCHIVE !== "false" : false,
    recommendArchiveRpc: process.env.GMX_RECOMMEND_ARCHIVE_RPC ? process.env.GMX_RECOMMEND_ARCHIVE_RPC !== "false" : true,
    gateMode: process.env.GMX_GATE_MODE === "warn" ? "warn" : "fail",
    printGateJson: process.env.GMX_PRINT_GATE_JSON === "true",
    mode: process.env.GMX_MODE || "auto",
    chainId: process.env.GMX_CHAIN_ID ? Number(process.env.GMX_CHAIN_ID) : null,
    dataStore: normalizeAddress(process.env.GMX_V2_DATASTORE || ""),
    reader: normalizeAddress(process.env.GMX_V2_READER || ""),
    v2Vault: normalizeAddress(process.env.GMX_V2_VAULT || ""),
    client: process.env.GMX_CLIENT || null,
    engagement: process.env.GMX_ENGAGEMENT || null,
    zip: process.env.GMX_ZIP_BUNDLE === "true",
    zipPath: process.env.GMX_ZIP_PATH || null,
    redact: process.env.GMX_REDACT_BUNDLE === "true",
    intakePath: null,
    intakeTargetCount: 0,
    intakeTargetIndex: null,
    intakeResolvedTargetIndex: 0,
    batchContinueOnError: true,
    batchFailFast: false,
    batchParallel: 1,
    batchRetry: 1,
    batchRetryBackoffMs: 2000,
    batchPreflight: true,
    batchArchive: null,
    batchNotify: null,
    strict: false,
    allowPartialSecurity: false,
    archiveRpcAvailable: null,
    securityTarget: null,
    csvPath: process.env.GMX_VAULT_CSV_PATH || "outputs/snapshots/vault_audit.csv",
    jsonPath: process.env.GMX_VAULT_JSON_PATH || "outputs/snapshots/vault_audit.json",
    _customCsvPath: false,
    _customJsonPath: false,
    _customReportHtml: false,
    _customReportMd: false
  };

  const intakePath = parseIntakePath(args);
  const intakeTargetIndex = parseIntakeTargetIndex(args);
  const batchParallel = parseBatchParallel(args);
  const batchRetry = parseBatchRetry(args);
  const batchRetryBackoffMs = parseBatchRetryBackoffMs(args);
  const batchPreflight = parseBatchPreflight(args);
  const batchArchive = parseBatchArchive(args);
  const batchNotify = parseBatchNotify(args);
  if (intakeTargetIndex !== null) {
    options.intakeTargetIndex = intakeTargetIndex;
  }
  if (batchParallel !== null) {
    options.batchParallel = batchParallel;
  }
  if (batchRetry !== null) {
    options.batchRetry = batchRetry;
  }
  if (batchRetryBackoffMs !== null) {
    options.batchRetryBackoffMs = batchRetryBackoffMs;
  }
  if (batchPreflight !== null) {
    options.batchPreflight = batchPreflight;
  }
  if (batchArchive !== null) {
    options.batchArchive = batchArchive;
  }
  if (batchNotify !== null) {
    options.batchNotify = batchNotify;
  }
  if (intakePath) {
    const intake = loadIntakeFile(intakePath);
    applyIntakeToOptions(options, intake);
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "vault") {
      continue;
    }

    const normalizedArgAddress = normalizeAddress(arg);
    if (normalizedArgAddress) {
      options.vault = normalizedArgAddress;
      continue;
    }

    if (arg === "--usd") {
      options.usd = true;
      continue;
    }

    if (arg === "--risk") {
      options.risk = true;
      continue;
    }

    if (arg === "--risk-summary") {
      options.riskSummary = true;
      continue;
    }

    if (arg === "--security") {
      options.security = true;
      continue;
    }

    if (arg === "--ai") {
      options.ai = true;
      continue;
    }

    if (arg === "--ai-url") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--ai-url requires a value");
      }
      options.aiUrl = next;
      i++;
      continue;
    }

    if (arg.startsWith("--ai-url=")) {
      options.aiUrl = arg.slice("--ai-url=".length).trim() || options.aiUrl;
      continue;
    }

    if (arg === "--ai-model") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--ai-model requires a value");
      }
      options.aiModel = next;
      i++;
      continue;
    }

    if (arg.startsWith("--ai-model=")) {
      options.aiModel = arg.slice("--ai-model=".length).trim() || options.aiModel;
      continue;
    }

    if (arg === "--fail-on-ai-high") {
      options.failOnAiHigh = true;
      continue;
    }

    if (arg === "--require-security") {
      options.requireSecurity = true;
      continue;
    }

    if (arg === "--require-block") {
      options.requireBlock = true;
      continue;
    }

    if (arg === "--require-archive") {
      options.requireArchive = true;
      continue;
    }

    if (arg === "--no-require-archive") {
      options.requireArchive = false;
      continue;
    }

    if (arg === "--recommend-archive-rpc") {
      options.recommendArchiveRpc = true;
      continue;
    }

    if (arg === "--no-recommend-archive-rpc") {
      options.recommendArchiveRpc = false;
      continue;
    }

    if (arg === "--fail-on-high") {
      options.failOnHigh = true;
      continue;
    }

    if (arg === "--no-fail-on-high") {
      options.failOnHigh = false;
      continue;
    }

    if (arg === "--fail-on-security-skip") {
      options.failOnSecuritySkip = true;
      continue;
    }

    if (arg === "--no-fail-on-security-skip") {
      options.failOnSecuritySkip = false;
      continue;
    }

    if (arg === "--gate-mode") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--gate-mode requires a value: fail|warn");
      }
      if (next !== "fail" && next !== "warn") {
        throw new Error("--gate-mode must be fail or warn");
      }
      options.gateMode = next;
      i++;
      continue;
    }

    if (arg.startsWith("--gate-mode=")) {
      const value = arg.slice("--gate-mode=".length).trim();
      if (value !== "fail" && value !== "warn") {
        throw new Error("--gate-mode must be fail or warn");
      }
      options.gateMode = value;
      continue;
    }

    if (arg === "--no-exit-nonzero") {
      options.gateMode = "warn";
      continue;
    }

    if (arg === "--print-gate-json") {
      options.printGateJson = true;
      continue;
    }

    if (arg === "--mode" || arg === "--gmx-mode") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--mode requires a value: auto|v1|v2");
      }
      options.mode = next.trim();
      i++;
      continue;
    }

    if (arg.startsWith("--mode=") || arg.startsWith("--gmx-mode=")) {
      const value = arg.includes("--mode=")
        ? arg.slice("--mode=".length).trim()
        : arg.slice("--gmx-mode=".length).trim();
      options.mode = value || options.mode;
      continue;
    }

    if (arg === "--chain-id") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--chain-id requires a value");
      }
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("--chain-id must be a positive integer");
      }
      options.chainId = parsed;
      i++;
      continue;
    }

    if (arg.startsWith("--chain-id=")) {
      const parsed = Number(arg.slice("--chain-id=".length).trim());
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("--chain-id must be a positive integer");
      }
      options.chainId = parsed;
      continue;
    }

    if (arg === "--datastore") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--datastore requires a value");
      }
      const parsed = normalizeAddress(next);
      if (!parsed) {
        throw new Error("--datastore must be a valid address");
      }
      options.dataStore = parsed;
      i++;
      continue;
    }

    if (arg.startsWith("--datastore=")) {
      const parsed = normalizeAddress(arg.slice("--datastore=".length).trim());
      if (!parsed) {
        throw new Error("--datastore must be a valid address");
      }
      options.dataStore = parsed;
      continue;
    }

    if (arg === "--reader") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--reader requires a value");
      }
      const parsed = normalizeAddress(next);
      if (!parsed) {
        throw new Error("--reader must be a valid address");
      }
      options.reader = parsed;
      i++;
      continue;
    }

    if (arg.startsWith("--reader=")) {
      const parsed = normalizeAddress(arg.slice("--reader=".length).trim());
      if (!parsed) {
        throw new Error("--reader must be a valid address");
      }
      options.reader = parsed;
      continue;
    }

    if (arg === "--v2-vault") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--v2-vault requires a value");
      }
      const parsed = normalizeAddress(next);
      if (!parsed) {
        throw new Error("--v2-vault must be a valid address");
      }
      options.v2Vault = parsed;
      i++;
      continue;
    }

    if (arg.startsWith("--v2-vault=")) {
      const parsed = normalizeAddress(arg.slice("--v2-vault=".length).trim());
      if (!parsed) {
        throw new Error("--v2-vault must be a valid address");
      }
      options.v2Vault = parsed;
      continue;
    }

    if (arg === "--fail-on-medium-count") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--fail-on-medium-count requires a value");
      }
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("--fail-on-medium-count must be a non-negative integer");
      }
      options.failOnMediumCount = parsed;
      i++;
      continue;
    }

    if (arg.startsWith("--fail-on-medium-count=")) {
      const parsed = Number(arg.slice("--fail-on-medium-count=".length).trim());
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("--fail-on-medium-count must be a non-negative integer");
      }
      options.failOnMediumCount = parsed;
      continue;
    }

    if (arg === "--full") {
      options.full = true;
      continue;
    }

    if (arg === "--bundle") {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        options.bundle = next;
        i++;
      } else {
        options.bundle = true;
      }
      continue;
    }

    if (arg.startsWith("--bundle=")) {
      const outputPath = arg.slice("--bundle=".length).trim();
      options.bundle = outputPath || true;
      continue;
    }

    if (arg === "--report-html") {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        options.reportHtml = next;
        options._customReportHtml = true;
        i++;
      } else {
        options.reportHtml = true;
      }
      continue;
    }

    if (arg.startsWith("--report-html=")) {
      const outputPath = arg.slice("--report-html=".length).trim();
      options.reportHtml = outputPath || true;
      options._customReportHtml = true;
      continue;
    }

    if (arg === "--report-md") {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        options.reportMd = next;
        options._customReportMd = true;
        i++;
      } else {
        options.reportMd = true;
      }
      continue;
    }

    if (arg.startsWith("--report-md=")) {
      const outputPath = arg.slice("--report-md=".length).trim();
      options.reportMd = outputPath || true;
      options._customReportMd = true;
      continue;
    }

    if (arg === "--csv") {
      options.csv = true;
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        options.csvPath = next;
        options._customCsvPath = true;
        i++;
      }
      continue;
    }

    if (arg.startsWith("--csv=")) {
      options.csv = true;
      options.csvPath = arg.slice("--csv=".length).trim() || options.csvPath;
      options._customCsvPath = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        options.jsonPath = next;
        options._customJsonPath = true;
        i++;
      }
      continue;
    }

    if (arg.startsWith("--json=")) {
      options.json = true;
      options.jsonPath = arg.slice("--json=".length).trim() || options.jsonPath;
      options._customJsonPath = true;
      continue;
    }

    if (arg === "--rpc") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--rpc requires a value");
      }
      options.rpc = next;
      i++;
      continue;
    }

    if (arg.startsWith("--rpc=")) {
      options.rpc = arg.slice("--rpc=".length).trim() || options.rpc;
      continue;
    }

    if (arg === "--block") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--block requires a value");
      }
      options.block = next;
      i++;
      continue;
    }

    if (arg.startsWith("--block=")) {
      options.block = arg.slice("--block=".length).trim() || options.block;
      continue;
    }

    if (arg === "--preview") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--preview requires a value");
      }
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--preview must be a positive number");
      }
      options.preview = Math.floor(parsed);
      i++;
      continue;
    }

    if (arg.startsWith("--preview=")) {
      const parsed = Number(arg.slice("--preview=".length).trim());
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--preview must be a positive number");
      }
      options.preview = Math.floor(parsed);
      continue;
    }

    if (arg === "--client") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--client requires a value");
      }
      options.client = next.trim();
      i++;
      continue;
    }

    if (arg.startsWith("--client=")) {
      options.client = arg.slice("--client=".length).trim() || null;
      continue;
    }

    if (arg === "--engagement") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--engagement requires a value");
      }
      options.engagement = next.trim();
      i++;
      continue;
    }

    if (arg.startsWith("--engagement=")) {
      options.engagement = arg.slice("--engagement=".length).trim() || null;
      continue;
    }

    if (arg === "--zip") {
      const next = args[i + 1];
      options.zip = true;
      if (next && !next.startsWith("--")) {
        options.zipPath = next;
        i++;
      }
      continue;
    }

    if (arg === "--intake") {
      i++;
      continue;
    }

    if (arg.startsWith("--intake=")) {
      continue;
    }

    if (arg === "--intake-target-index") {
      i++;
      continue;
    }

    if (arg.startsWith("--intake-target-index=")) {
      continue;
    }

    if (arg === "--batch-continue-on-error") {
      options.batchContinueOnError = true;
      options.batchFailFast = false;
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

    if (arg === "--batch-fail-fast") {
      options.batchFailFast = true;
      options.batchContinueOnError = false;
      continue;
    }

    if (arg === "--batch-parallel") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--batch-parallel requires a positive integer");
      }
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("--batch-parallel must be a positive integer");
      }
      options.batchParallel = parsed;
      i++;
      continue;
    }

    if (arg.startsWith("--batch-parallel=")) {
      const parsed = Number(arg.slice("--batch-parallel=".length).trim());
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("--batch-parallel must be a positive integer");
      }
      options.batchParallel = parsed;
      continue;
    }

    if (arg === "--batch-retry") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--batch-retry requires an integer >= 1");
      }
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error("--batch-retry must be an integer >= 1");
      }
      options.batchRetry = parsed;
      i++;
      continue;
    }

    if (arg.startsWith("--batch-retry=")) {
      const parsed = Number(arg.slice("--batch-retry=".length).trim());
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error("--batch-retry must be an integer >= 1");
      }
      options.batchRetry = parsed;
      continue;
    }

    if (arg === "--batch-retry-backoff-ms") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--batch-retry-backoff-ms requires an integer >= 0");
      }
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("--batch-retry-backoff-ms must be an integer >= 0");
      }
      options.batchRetryBackoffMs = parsed;
      i++;
      continue;
    }

    if (arg.startsWith("--batch-retry-backoff-ms=")) {
      const parsed = Number(arg.slice("--batch-retry-backoff-ms=".length).trim());
      if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("--batch-retry-backoff-ms must be an integer >= 0");
      }
      options.batchRetryBackoffMs = parsed;
      continue;
    }

    if (arg === "--batch-preflight") {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        const value = String(next).trim();
        if (value !== "0" && value !== "1") {
          throw new Error("--batch-preflight must be 0 or 1");
        }
        options.batchPreflight = value === "1";
        i++;
      } else {
        options.batchPreflight = true;
      }
      continue;
    }

    if (arg === "--batch-archive") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--batch-archive requires a value (s3://bucket[/prefix] or ipfs://pinata)");
      }
      options.batchArchive = String(next).trim();
      i++;
      continue;
    }

    if (arg.startsWith("--batch-archive=")) {
      const value = arg.slice("--batch-archive=".length).trim();
      if (!value) {
        throw new Error("--batch-archive requires a value (s3://bucket[/prefix] or ipfs://pinata)");
      }
      options.batchArchive = value;
      continue;
    }

    if (arg === "--batch-notify") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--batch-notify requires an email address");
      }
      options.batchNotify = String(next).trim();
      i++;
      continue;
    }

    if (arg.startsWith("--batch-notify=")) {
      const value = arg.slice("--batch-notify=".length).trim();
      if (!value) {
        throw new Error("--batch-notify requires an email address");
      }
      options.batchNotify = value;
      continue;
    }

    if (arg.startsWith("--batch-preflight=")) {
      const value = arg.slice("--batch-preflight=".length).trim();
      if (value !== "0" && value !== "1") {
        throw new Error("--batch-preflight must be 0 or 1");
      }
      options.batchPreflight = value === "1";
      continue;
    }

    if (arg.startsWith("--zip=")) {
      options.zip = true;
      options.zipPath = arg.slice("--zip=".length).trim() || null;
      continue;
    }

    if (arg === "--redact") {
      options.redact = true;
      continue;
    }

    if (arg === "--no-redact") {
      options.redact = false;
      continue;
    }
  }

  if (options.full) {
    options.usd = true;
    options.risk = true;
    options.riskSummary = true;
    options.csv = true;
    options.json = true;
    options.security = true;
  }

  if (options.bundle) {
    options.csv = true;
    options.json = true;
    options.reportHtml = options.reportHtml || true;
    options.reportMd = options.reportMd || true;
    options.security = true;
  }

  if (options.ai) {
    options.security = true;
    options.json = true;
    options.bundle = options.bundle || true;
  }

  if (!["auto", "v1", "v2"].includes(String(options.mode || "").toLowerCase())) {
    throw new Error("--mode must be one of: auto, v1, v2");
  }
  options.mode = String(options.mode).toLowerCase();

  if (options.chainId !== null && (!Number.isInteger(options.chainId) || options.chainId <= 0)) {
    throw new Error("--chain-id must be a positive integer");
  }

  if (options.requireBlock && String(options.block).toLowerCase() === "latest") {
    throw new Error("--require-block is enabled; pass an explicit --block <number>");
  }

  return options;
}

function sanitizeForPath(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function isArchiveUnavailableError(error) {
  const candidates = [
    error && error.shortMessage,
    error && error.message,
    error && error.reason,
    error && error.error && error.error.message,
    error && error.info && error.info.error && error.info.error.message,
    error && error.payload && error.payload.error && error.payload.error.message,
    error
  ];
  const msg = candidates
    .filter(Boolean)
    .map((v) => String(v).toLowerCase())
    .join(" | ");
  return msg.includes("missing trie node")
    || msg.includes("state is not available")
    || msg.includes("header not found")
    || msg.includes("historical state")
    || msg.includes("pruned")
    || msg.includes("archive");
}

function getArchiveRecommendationLine() {
  return "Recommended: rerun with an archive-capable RPC endpoint (Alchemy/Infura/QuickNode archive tier).";
}

function readJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    // Strip UTF-8 BOM if present (PowerShell Set-Content writes it by default)
    const stripped = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    return JSON.parse(stripped);
  } catch (_) {
    return null;
  }
}

function redactSensitiveText(input) {
  let output = String(input || "");

  // Windows user profile paths
  output = output.replace(/([A-Za-z]:\\Users\\)([^\\\s"']+)/g, "$1REDACTED");
  // Escaped Windows user profile paths in JSON strings
  output = output.replace(/([A-Za-z]:\\\\Users\\\\)([^\\\s"']+)/g, "$1REDACTED");
  // Unix/macOS profile paths
  output = output.replace(/(\/Users\/)([^\/\s"']+)/g, "$1REDACTED");
  output = output.replace(/(\/home\/)([^\/\s"']+)/g, "$1REDACTED");

  // Redact common RPC URL forms to host-only marker
  output = output.replace(/https?:\/\/([^\/\s"']+)\/rpc[^\s"']*/gi, (_match, host) => `[rpc-host:${host}]`);

  return output;
}

function shouldRedactFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return REDACT_TEXT_EXTENSIONS.has(ext);
}

function redactBundleFiles(bundleDir) {
  const touchedFiles = [];

  function visit(currentPath) {
    const stat = fs.statSync(currentPath);
    if (stat.isDirectory()) {
      const names = fs.readdirSync(currentPath);
      for (const name of names) {
        visit(path.join(currentPath, name));
      }
      return;
    }

    if (!shouldRedactFile(currentPath)) {
      return;
    }

    const original = fs.readFileSync(currentPath, "utf8");
    const redacted = redactSensitiveText(original);
    if (redacted !== original) {
      fs.writeFileSync(currentPath, redacted, "utf8");
      touchedFiles.push(currentPath);
    }
  }

  if (fs.existsSync(bundleDir) && fs.statSync(bundleDir).isDirectory()) {
    visit(bundleDir);
  }

  return {
    touchedFiles,
    touchedCount: touchedFiles.length
  };
}

function loadChainConfig(chainId) {
  if (!Number.isInteger(chainId) || chainId <= 0) {
    return { config: null, path: null };
  }
  if (!fs.existsSync(CHAIN_CONFIG_DIR)) {
    return { config: null, path: null };
  }

  const files = fs.readdirSync(CHAIN_CONFIG_DIR).filter((name) => name.startsWith(`${chainId}.`) && name.endsWith(".json"));
  if (files.length === 0) {
    return { config: null, path: null };
  }

  const fullPath = path.join(CHAIN_CONFIG_DIR, files[0]);
  const config = readJsonFile(fullPath);
  return { config, path: fullPath };
}

function mergeFeedMap(chainId, chainConfig) {
  const builtIn = ADDRESS_PRICE_FEEDS[chainId] || {};
  const fromConfig = chainConfig && chainConfig.chainlinkFeedsByToken ? chainConfig.chainlinkFeedsByToken : {};

  const merged = {};
  for (const [token, feed] of Object.entries(builtIn)) {
    const t = normalizeAddress(token);
    const f = normalizeAddress(feed);
    if (t && f) {
      merged[t.toLowerCase()] = f;
    }
  }
  for (const [token, feed] of Object.entries(fromConfig)) {
    const t = normalizeAddress(token);
    const f = normalizeAddress(feed);
    if (t && f) {
      merged[t.toLowerCase()] = f;
    }
  }
  return merged;
}

function buildTokenMetadataOverrides(chainConfig) {
  const raw = chainConfig && chainConfig.tokenMetadata && typeof chainConfig.tokenMetadata === "object"
    ? chainConfig.tokenMetadata
    : {};

  const normalized = {};
  for (const [tokenAddress, metadata] of Object.entries(raw)) {
    const address = normalizeAddress(tokenAddress);
    if (!address || !metadata || typeof metadata !== "object") {
      continue;
    }

    const symbol = sanitizeTokenText(metadata.symbol) || "N/A";
    const name = sanitizeTokenText(metadata.name) || "N/A";
    const decimalsNumber = Number(metadata.decimals);
    const decimals = Number.isFinite(decimalsNumber) && decimalsNumber >= 0 && decimalsNumber <= 255
      ? Math.trunc(decimalsNumber)
      : 18;

    normalized[address.toLowerCase()] = {
      symbol,
      name,
      decimals
    };
  }

  return normalized;
}

async function callContractMethod(contract, method, args, blockTag) {
  const provider = contract.runner && contract.runner.provider
    ? contract.runner.provider
    : contract.provider;

  if (!provider || typeof provider.call !== "function") {
    throw new Error("Contract provider is unavailable for read call");
  }

  const fragment = contract.interface.getFunction(method);
  if (!fragment) {
    throw new Error(`Method ${method} not found on contract`);
  }

  const data = contract.interface.encodeFunctionData(fragment, args);
  const callTx = {
    to: contract.target,
    data
  };

  const raw = blockTag === undefined || blockTag === null || blockTag === "latest"
    ? await provider.call(callTx)
    : await provider.call(callTx, blockTag);

  const decoded = contract.interface.decodeFunctionResult(fragment, raw);
  if (!decoded || decoded.length === 0) {
    return null;
  }
  return decoded.length === 1 ? decoded[0] : decoded;
}

async function probeTargetMode(vaultContract, blockTag) {
  const probes = {
    allWhitelistedTokensLength: false,
    whitelistedTokenCount: false
  };

  try {
    await callContractMethod(vaultContract, "allWhitelistedTokensLength", [], blockTag);
    probes.allWhitelistedTokensLength = true;
  } catch (_) {
    probes.allWhitelistedTokensLength = false;
  }

  try {
    await callContractMethod(vaultContract, "whitelistedTokenCount", [], blockTag);
    probes.whitelistedTokenCount = true;
  } catch (_) {
    probes.whitelistedTokenCount = false;
  }

  const isV1 = probes.allWhitelistedTokensLength || probes.whitelistedTokenCount;
  return {
    isV1,
    probes
  };
}

function writeBundleReadme(input) {
  const v2Section = input.v2
    ? [
      "",
      "V2 Context:",
      `- Reader: ${input.v2.reader || "N/A"}`,
      `- DataStore: ${input.v2.dataStore || "N/A"}`,
      `- Markets: ${input.v2.marketCount}`,
      `- Collateral Tokens: ${input.v2.collateralCount}`
    ]
    : [];

  const archiveSection = input.archive
    ? [
      "",
      "Archive RPC Notes:",
      "- Snapshot is block-pinned and complete.",
      input.archive.partialSecurity
        ? "- Security analysis at historical block was partial due to RPC archive limitations."
        : "- Security analysis had archive state available for requested block.",
      input.archive.partialSecurity
        ? "- If full historical security is required, rerun with an archive RPC endpoint."
        : "- No archive-related security gaps were detected for this run."
    ]
    : [];

  const archiveHintSection = input.archiveHint
    ? [
      `- Chain hint: ${input.archiveHint}`,
      "- Public RPC endpoints are acceptable for latest-block scans but may produce partial historical metadata."
    ]
    : [];

  const lines = [
    "GMX Vault Auditor Deliverable",
    "",
    "How to use:",
    "1) Open report.html for the executive-friendly view.",
    "2) Use report.md for raw markdown sharing.",
    "3) Review manifest.json for evidence integrity (block-pinned + hashes).",
    "4) Inspect security/ for normalized and raw tool outputs.",
    "5) AI outputs are advisory and should be manually validated.",
    "",
    "Run metadata:",
    `- Client: ${input.client || "N/A"}`,
    `- Engagement: ${input.engagement || "N/A"}`,
    `- Chain: ${input.network.name} (${input.network.chainId})`,
    `- Vault: ${input.vault}`,
    `- Block: ${input.block.number}`,
    `- Block Hash: ${input.block.hash}`,
    `- Mode: ${input.modeResolved}`,
    ...v2Section,
    ...archiveSection,
    ...archiveHintSection,
    "",
    "Disclaimer:",
    "This report is point-in-time evidence and does not guarantee future protocol safety."
  ];

  const filePath = path.join(input.bundleDir, "README.txt");
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
  return filePath;
}

function getDateStamp() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function hashTarget(target) {
  return crypto.createHash("sha256").update(JSON.stringify(target || {})).digest("hex").slice(0, 8);
}

function getIntakeSchemaVersion(doc) {
  if (doc && (typeof doc.schemaVersion === "string" || typeof doc.schemaVersion === "number")) {
    return String(doc.schemaVersion);
  }
  return "1";
}

function buildBatchZipFileName(options, target, chainName, mode, resolvedBlock) {
  const clientPart = sanitizeForPath(options.client || "client");
  const engagementPart = sanitizeForPath(options.engagement || "engagement");
  const chainPart = sanitizeForPath(chainName || "unknown").toLowerCase();
  const modePart = sanitizeForPath(mode || "auto").toLowerCase();
  const blockPart = Number.isInteger(resolvedBlock)
    ? String(resolvedBlock)
    : "latest";
  const hashPart = hashTarget(target);
  return `${clientPart}_${engagementPart}_${chainPart}_${modePart}_${blockPart}_${hashPart}.zip`;
}

function collectBatchTopRisks(rows, limit = 5) {
  const risks = [];

  for (const row of rows) {
    if (!Array.isArray(row.topRiskTokens)) {
      continue;
    }

    for (const token of row.topRiskTokens) {
      const riskScore = Number(token.riskScore || 0);
      const exposurePct = Number(token.exposurePct || 0);
      risks.push({
        chainName: row.chainName || String(row.chainId || "unknown"),
        chainId: row.chainId || null,
        targetIndex: row.i,
        symbol: token.symbol || "N/A",
        address: token.address || "N/A",
        riskScore,
        exposurePct,
        evidencePath: `${row.bundleDir}/report.html#token-risk-table`
      });
    }
  }

  risks.sort((a, b) => {
    if (b.riskScore !== a.riskScore) return b.riskScore - a.riskScore;
    if (b.exposurePct !== a.exposurePct) return b.exposurePct - a.exposurePct;
    if (a.chainName !== b.chainName) return a.chainName.localeCompare(b.chainName);
    if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
    return a.address.localeCompare(b.address);
  });

  return risks.slice(0, Math.max(0, Number(limit) || 0));
}

function targetLabel(target, index, resolvedBlockNumber, chainName) {
  const chainPart = Number.isInteger(target && target.chainId)
    ? String(target.chainId)
    : "chain";
  const chainNamePart = sanitizeForPath(chainName || "unknown").toLowerCase();
  const modePart = sanitizeForPath((target && target.mode) || "auto").toLowerCase();
  const blockPart = Number.isInteger(resolvedBlockNumber)
    ? String(resolvedBlockNumber)
    : sanitizeForPath(String((target && target.block) || "latest"));
  const hashPart = hashTarget(target);
  return `${String(index + 1).padStart(2, "0")}_${chainNamePart}_${chainPart}_${modePart}_${blockPart}_${hashPart}`;
}

function getBatchBundleRoot(options) {
  if (options.bundle && options.bundle !== true) {
    return path.resolve(process.cwd(), String(options.bundle));
  }

  const labels = [];
  if (options.client) {
    labels.push(sanitizeForPath(options.client));
  }
  if (options.engagement) {
    labels.push(sanitizeForPath(options.engagement));
  }
  labels.push("intake_batch", getDateStamp());
  return path.resolve(process.cwd(), "outputs/bundles", labels.join("_"));
}

function readManifestSummary(manifestPath) {
  const manifest = readJsonFile(manifestPath);
  if (!manifest || typeof manifest !== "object") {
    return null;
  }

  return {
    vault: manifest.vault || null,
    chainId: manifest.network && manifest.network.chainId ? Number(manifest.network.chainId) : null,
    network: manifest.network && manifest.network.name ? String(manifest.network.name) : null,
    block: manifest.block && Number.isInteger(manifest.block.resolved) ? manifest.block.resolved : null,
    modeResolved: manifest.modes && manifest.modes.modeResolved ? String(manifest.modes.modeResolved) : null,
    gatePassed: manifest.gate ? Boolean(manifest.gate.passed) : null,
    partialSecurity: manifest.security ? Boolean(manifest.security.partial) : false
  };
}

function parseGateJsonFromOutput(outputText) {
  if (!outputText) {
    return null;
  }

  const lines = String(outputText).split(/\r?\n/);
  let payload = null;
  for (const line of lines) {
    if (line.startsWith("GATE_JSON:")) {
      payload = line.slice("GATE_JSON:".length);
    }
  }

  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(payload);
  } catch (_) {
    return null;
  }
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientBatchError(outputText) {
  const text = String(outputText || "").toLowerCase();
  const markers = [
    "429",
    "rate limit",
    "too many requests",
    "gateway timeout",
    "timed out",
    "rpc call timed out",
    "econnreset",
    "etimedout",
    "eai_again"
  ];

  return markers.some((marker) => text.includes(marker));
}

function verifyTargetArtifacts(bundleDir, securityRequested, expectedZipFileName, redactExpected) {
  const missing = [];
  const required = [
    "manifest.json",
    "report.html",
    "audit.json",
    expectedZipFileName || "bundle.zip"
  ];

  for (const name of required) {
    const filePath = path.join(bundleDir, name);
    if (!fs.existsSync(filePath)) {
      missing.push(name);
    }
  }

  if (securityRequested) {
    const securityRunPath = path.join(bundleDir, "security", "run.json");
    if (!fs.existsSync(securityRunPath)) {
      missing.push("security/run.json");
    }
  }

  const manifestPath = path.join(bundleDir, "manifest.json");
  if (redactExpected && fs.existsSync(manifestPath)) {
    const manifest = readJsonFile(manifestPath);
    const redactionEnabled = Boolean(manifest && manifest.redaction && manifest.redaction.enabled);
    const redactionWarnings = manifest && manifest.redaction && Array.isArray(manifest.redaction.warnings)
      ? manifest.redaction.warnings
      : [];
    if (!redactionEnabled) {
      return {
        ok: false,
        reason: "redaction expected but manifest.redaction.enabled is false"
      };
    }
    if (redactionWarnings.length > 0) {
      return {
        ok: false,
        reason: `redaction warnings present: ${redactionWarnings.join(", ")}`
      };
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      reason: `missing required artifacts: ${missing.join(", ")}`
    };
  }

  return {
    ok: true,
    reason: "ok"
  };
}

function readAuditSummary(bundleDir) {
  const auditPath = path.join(bundleDir, "audit.json");
  const data = readJsonFile(auditPath);
  if (!data || typeof data !== "object") {
    return null;
  }

  return {
    summary: data.summary || null,
    tokens: Array.isArray(data.tokens) ? data.tokens : [],
    markets: Array.isArray(data.markets) ? data.markets : []
  };
}

async function resolveTargetRuntime(target, defaultRpc) {
  const rpc = target && target.rpc ? String(target.rpc) : defaultRpc;
  const provider = new ethers.JsonRpcProvider(rpc);
  const network = await provider.getNetwork();
  const runtimeChainId = Number(network.chainId);
  const effectiveChainId = Number.isInteger(target && target.chainId) && target.chainId > 0
    ? target.chainId
    : runtimeChainId;

  if (Number.isInteger(target && target.chainId) && target.chainId > 0 && target.chainId !== runtimeChainId) {
    throw new Error(`target chainId ${target.chainId} does not match RPC chainId ${runtimeChainId}`);
  }

  const requestedBlockRaw = target && target.block !== undefined && target.block !== null
    ? String(target.block)
    : "latest";
  const blockTag = toBlockTag(requestedBlockRaw);
  const resolvedBlock = blockTag === "latest"
    ? await provider.getBlockNumber()
    : blockTag;

  const { config: chainConfig } = loadChainConfig(effectiveChainId);
  const chainName = getDisplayNetworkName(network, chainConfig, effectiveChainId);

  return {
    chainId: effectiveChainId,
    chainName,
    requestedBlock: requestedBlockRaw,
    resolvedBlock,
    mode: String((target && target.mode) || "auto").toLowerCase(),
    rpc
  };
}

function writeBatchIndex(rootDir, rows) {
  const generatedAt = new Date().toISOString();
  const indexJsonPath = path.join(rootDir, "index.json");
  const indexMdPath = path.join(rootDir, "index.md");
  const topRisks = collectBatchTopRisks(rows, 5);

  const payload = {
    generatedAt,
    targetCount: rows.length,
    successCount: rows.filter((row) => row.status === "success").length,
    failureCount: rows.filter((row) => row.status === "failed").length,
    skippedCount: rows.filter((row) => row.status === "skipped").length,
    topRisks,
    targets: rows
  };
  fs.writeFileSync(indexJsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const lines = [
    "GMX Intake Batch Index",
    "",
    `Generated: ${generatedAt}`,
    `Targets: ${payload.targetCount}`,
    `Succeeded: ${payload.successCount}`,
    `Failed: ${payload.failureCount}`,
    `Skipped: ${payload.skippedCount}`,
    "",
    "| # | Status | Chain | Mode | Requested Block | Resolved Block | Duration(ms) | Bundle |",
    "|---|---|---|---|---|---|---|---|"
  ];

  for (const row of rows) {
    lines.push(
      `| ${row.i} | ${row.status} | ${row.chainId || "N/A"} | ${row.mode || "N/A"} | ${row.requestedBlock || "N/A"} | ${row.resolvedBlock || "N/A"} | ${row.durationMs || 0} | ${row.bundleDir || "N/A"} |`
    );
  }

  lines.push("", "Download Zips:");
  const completedRows = rows.filter((row) => row.status === "success" && row.zipPath);
  if (completedRows.length === 0) {
    lines.push("- No successful target zips available.");
  } else {
    for (const row of completedRows) {
      const zipName = path.basename(row.zipPath);
      lines.push(`- ${row.chainName || row.chainId || "unknown"}: [${zipName}](${row.zipPath})`);
    }
  }

  lines.push("", "Top Cross-Chain Risks:");
  if (topRisks.length === 0) {
    lines.push("- No token-level high-signal risks were detected.");
  } else {
    topRisks.forEach((risk, idx) => {
      lines.push(`${idx + 1}. ${risk.chainName} ${risk.symbol} (${risk.address}) score=${risk.riskScore} exposurePct=${risk.exposurePct.toFixed(2)} -> [evidence](${risk.evidencePath})`);
    });
  }

  lines.push("", "Notes:");
  lines.push("- Each target directory contains run.log, manifest.json, report artifacts, and a client-named zip file.");
  lines.push("- gate.json is captured from GATE_JSON output when available.");
  lines.push("- status=failed may come from non-zero exit code or failed artifact QA checks.");

  fs.writeFileSync(indexMdPath, `${lines.join("\n")}\n`, "utf8");

  return {
    indexJsonPath,
    indexMdPath,
    topRisks
  };
}

function writeBatchReadme(rootDir, rows) {
  const total = rows.length;
  const succeeded = rows.filter((row) => row.status === "success").length;
  const failed = rows.filter((row) => row.status === "failed").length;
  const skipped = rows.filter((row) => row.status === "skipped").length;

  const marketsTotal = rows.reduce((sum, row) => sum + Number(row.marketCount || 0), 0);
  const collateralTotal = rows.reduce((sum, row) => sum + Number(row.collateralTokenCount || 0), 0);
  const partialChains = rows.filter((row) => row.partialSecurity).map((row) => `${row.chainName || row.chainId || "unknown"} (${row.i})`);

  const topRisks = collectBatchTopRisks(rows, 5);

  const lines = [
    "GMX Multi-Target Engagement Summary",
    "",
    `Targets run: ${total}, succeeded: ${succeeded}, failed: ${failed}, skipped: ${skipped}`,
    "",
    "Rollup:",
    `- Total markets observed: ${marketsTotal}`,
    `- Total collateral tokens observed: ${collateralTotal}`,
    `- Partial security chains: ${partialChains.length > 0 ? partialChains.join(", ") : "none"}`,
    "",
    "Top 5 cross-chain risks:",
    ...topRisks.map((risk, idx) => {
      return `${idx + 1}. ${risk.chainName} ${risk.symbol} (${risk.address}) score=${risk.riskScore} exposurePct=${risk.exposurePct.toFixed(2)} evidence=${risk.evidencePath}`;
    }),
    "",
    "Artifacts:",
    "- index.md: human-readable execution index",
    "- index.json: machine-readable execution index",
    "- targets/<NN_...>/: per-target bundle, run.log, gate.json, bundle.zip"
  ];

  if (topRisks.length === 0) {
    lines.splice(lines.indexOf("Top 5 cross-chain risks:") + 1, 0, "- No token-level risk rows were available.");
  }

  const readmePath = path.join(rootDir, "README.txt");
  fs.writeFileSync(readmePath, `${lines.join("\n")}\n`, "utf8");
  return readmePath;
}

function parsePreflightOutput(stdout, stderr, exitCode, command) {
  const text = `${stdout || ""}\n${stderr || ""}`;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  let passed = exitCode === 0;
  let targetCount = null;
  const targetSummaries = [];
  const strictFlags = [];
  const warnings = [];
  let currentTarget = null;

  for (const line of lines) {
    if (line.startsWith("Targets:")) {
      const parsed = Number(line.replace("Targets:", "").trim());
      if (Number.isInteger(parsed) && parsed >= 0) {
        targetCount = parsed;
      }
      continue;
    }

    if (line.startsWith("Target chainId=")) {
      if (currentTarget) {
        targetSummaries.push(currentTarget);
      }
      const match = line.match(/^Target chainId=(\d+)\s+rpc=(.+)$/i);
      currentTarget = {
        header: line,
        chainId: match ? Number(match[1]) : null,
        rpc: match ? match[2] : null,
        rpcGrade: null,
        archiveStatus: "unknown",
        rateLimitObserved: null,
        passCount: 0,
        failCount: 0,
        infoCount: 0
      };
      continue;
    }

    if (line.includes("Preflight result:")) {
      passed = line.toUpperCase().includes("PASSED");
      continue;
    }

    if (line.toLowerCase().includes("strict mode")) {
      strictFlags.push(line);
    }

    if (!currentTarget) {
      continue;
    }

    if (line.includes("[PASS]")) {
      currentTarget.passCount += 1;
      if (line.toLowerCase().includes("archive probe skipped")) {
        currentTarget.archiveStatus = "skipped";
      }
      if (line.toLowerCase().includes("archive probe") && line.toLowerCase().includes("succeeded")) {
        currentTarget.archiveStatus = "ok";
      }
    } else if (line.includes("[FAIL]")) {
      currentTarget.failCount += 1;
      warnings.push(`chainId=${currentTarget.chainId || "unknown"}: ${line}`);
      if (line.toLowerCase().includes("archive probe")) {
        currentTarget.archiveStatus = "failed";
      }
    } else if (line.includes("[INFO]")) {
      currentTarget.infoCount += 1;
      const gradeMatch = line.match(/rpcGrade=([A-Za-z]+)/);
      if (gradeMatch) {
        currentTarget.rpcGrade = gradeMatch[1].toUpperCase();
      }
      const rateLimitMatch = line.match(/rateLimitObserved=(true|false)/i);
      if (rateLimitMatch) {
        currentTarget.rateLimitObserved = rateLimitMatch[1].toLowerCase() === "true";
      }
    }
  }

  if (currentTarget) {
    targetSummaries.push(currentTarget);
  }

  const normalized = {
    passed,
    targetCount: Number.isInteger(targetCount) ? targetCount : targetSummaries.length,
    rpcGrades: targetSummaries.map((target) => ({
      chainId: target.chainId,
      rpc: target.rpc,
      rpcGrade: target.rpcGrade || "unknown",
      archiveStatus: target.archiveStatus || "unknown",
      rateLimitObserved: target.rateLimitObserved === null ? null : target.rateLimitObserved
    })),
    strictFlags,
    warnings
  };

  return {
    integrated: true,
    command,
    exitCode,
    passed,
    targetCount,
    normalized,
    targetSummaries,
    stdout,
    stderr
  };
}

function runBatchPreflight(options, rootDir) {
  const preflightScript = path.resolve(process.cwd(), "scripts", "preflight.js");
  const preflightArgs = [
    preflightScript,
    "--intake",
    options.intakePath
  ];

  if (options.strict) {
    preflightArgs.push("--strict");
  }
  if (options.allowPartialSecurity) {
    preflightArgs.push("--allow-partial-security");
  }
  if (options.requireSecurity) {
    preflightArgs.push("--require-security");
  }

  const run = spawnSync(process.execPath, preflightArgs, {
    encoding: "utf8",
    env: process.env,
    maxBuffer: 10 * 1024 * 1024
  });

  const summary = parsePreflightOutput(
    run.stdout || "",
    run.stderr || "",
    typeof run.status === "number" ? run.status : 1,
    `${process.execPath} ${preflightArgs.join(" ")}`
  );

  const preflightPath = path.join(rootDir, "preflight.json");
  fs.writeFileSync(preflightPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (run.stdout) {
    process.stdout.write(run.stdout);
  }
  if (run.stderr) {
    process.stderr.write(run.stderr);
  }

  return {
    summary,
    preflightPath
  };
}

async function archiveToS3(rootZipPath, archiveTarget, options) {
  const match = String(archiveTarget).match(/^s3:\/\/([^\/]+)(?:\/(.*))?$/i);
  if (!match) {
    throw new Error("Invalid s3 archive target. Expected s3://bucket[/prefix]");
  }

  let S3Client;
  let PutObjectCommand;
  try {
    ({ S3Client, PutObjectCommand } = require("@aws-sdk/client-s3"));
  } catch (_) {
    throw new Error("Missing dependency @aws-sdk/client-s3. Install with: npm install @aws-sdk/client-s3");
  }

  const bucket = match[1];
  const prefix = match[2] ? String(match[2]).replace(/^\/+|\/+$/g, "") : "";
  const region = process.env.AWS_REGION || "us-east-1";
  const fileBase = path.basename(rootZipPath);
  const objectName = `${sanitizeForPath(options.client || "client")}_${sanitizeForPath(options.engagement || "engagement")}_${Date.now()}_${fileBase}`;
  const key = prefix ? `${prefix}/${objectName}` : objectName;

  const s3 = new S3Client({ region });
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fs.readFileSync(rootZipPath)
  }));

  const encodedKey = encodeURIComponent(key).replace(/%2F/g, "/");
  const location = `https://${bucket}.s3.${region}.amazonaws.com/${encodedKey}`;

  return {
    provider: "s3",
    target: archiveTarget,
    bucket,
    key,
    url: location
  };
}

async function archiveToIpfs(rootZipPath, archiveTarget, options) {
  let PinataSDK;
  try {
    PinataSDK = require("@pinata/sdk");
  } catch (_) {
    throw new Error("Missing dependency @pinata/sdk. Install with: npm install @pinata/sdk");
  }

  const jwt = process.env.PINATA_JWT || null;
  const apiKey = process.env.PINATA_API_KEY || null;
  const apiSecret = process.env.PINATA_API_SECRET || null;

  let pinata;
  if (jwt) {
    pinata = new PinataSDK({ pinataJWTKey: jwt });
  } else if (apiKey && apiSecret) {
    pinata = new PinataSDK(apiKey, apiSecret);
  } else {
    throw new Error("Pinata credentials missing. Set PINATA_JWT or PINATA_API_KEY and PINATA_API_SECRET");
  }

  const result = await pinata.pinFileToIPFS(fs.createReadStream(rootZipPath), {
    pinataMetadata: {
      name: `${sanitizeForPath(options.client || "client")}_${sanitizeForPath(options.engagement || "engagement")}_${path.basename(rootZipPath)}`
    }
  });

  if (!result || !result.IpfsHash) {
    throw new Error("IPFS pin succeeded but did not return IpfsHash");
  }

  return {
    provider: "ipfs",
    target: archiveTarget,
    ipfsHash: result.IpfsHash,
    url: `https://gateway.pinata.cloud/ipfs/${result.IpfsHash}`
  };
}

async function archiveBatchRoot(rootDir, options) {
  const rootZipPath = `${rootDir}.zip`;
  await zipDirectory(rootDir, rootZipPath);

  const target = String(options.batchArchive || "").trim();
  if (!target) {
    return null;
  }

  let archive;
  if (target.toLowerCase().startsWith("s3://")) {
    archive = await archiveToS3(rootZipPath, target, options);
  } else if (target.toLowerCase().startsWith("ipfs://")) {
    archive = await archiveToIpfs(rootZipPath, target, options);
  } else {
    throw new Error("Unsupported --batch-archive target. Use s3://bucket[/prefix] or ipfs://...");
  }

  return {
    ...archive,
    rootZipPath,
    rootZipSha256: sha256File(rootZipPath),
    rootZipRelative: path.relative(process.cwd(), rootZipPath).replace(/\\/g, "/")
  };
}

async function sendBatchNotification(options, archiveInfo, rootDir, manifestPath) {
  if (!options.batchNotify) {
    return null;
  }

  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch (_) {
    throw new Error("Missing dependency nodemailer. Install with: npm install nodemailer");
  }

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpSecure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
  const smtpUser = process.env.SMTP_USER || null;
  const smtpPass = process.env.SMTP_PASS || null;
  const fromAddress = process.env.EMAIL_FROM || (smtpUser || "noreply@gmx-audit.local");

  if (!smtpHost) {
    throw new Error("SMTP_HOST is required for --batch-notify");
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined
  });

  const archiveLine = archiveInfo && archiveInfo.url
    ? `Archive URL: ${archiveInfo.url}`
    : `Local bundle root: ${rootDir}`;

  const textBody = [
    `Client: ${options.client || "N/A"}`,
    `Engagement: ${options.engagement || "N/A"}`,
    archiveLine,
    `Manifest: ${manifestPath}`
  ].join("\n");

  const info = await transporter.sendMail({
    from: fromAddress,
    to: options.batchNotify,
    subject: `${options.client || "Client"} ${options.engagement || "Engagement"} audit bundle is ready`,
    text: textBody
  });

  return {
    to: options.batchNotify,
    messageId: info && info.messageId ? info.messageId : null
  };
}

function patchEngagementManifestWithDelivery(manifestPath, archiveInfo, notificationInfo) {
  const manifest = readJsonFile(manifestPath) || {};

  if (archiveInfo) {
    manifest.archive = {
      provider: archiveInfo.provider,
      target: archiveInfo.target,
      url: archiveInfo.url || null,
      rootZipPath: archiveInfo.rootZipRelative,
      rootZipSha256: archiveInfo.rootZipSha256
    };
    manifest.archiveUrl = archiveInfo.url || null;
    manifest.archiveHash = archiveInfo.rootZipSha256;
  }

  if (notificationInfo) {
    manifest.notification = {
      sent: true,
      to: notificationInfo.to,
      recipient: notificationInfo.to,
      messageId: notificationInfo.messageId
    };
  } else if (manifest.notification === undefined) {
    manifest.notification = {
      sent: false,
      to: null,
      recipient: null,
      messageId: null
    };
  }

  if (!manifest.metrics || typeof manifest.metrics !== "object") {
    manifest.metrics = {};
  }
  manifest.metrics.archive_success = Boolean(manifest.archiveUrl);

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function writeEngagementManifest(rootDir, options, intake, rows, indexPaths, batchReadmePath, batchStartMs) {
  const intakeHash = sha256File(options.intakePath);
  const intakeSchemaVersion = getIntakeSchemaVersion(intake && intake.doc);
  const targetHashes = rows.map((row) => {
    const zipAbsolutePath = row.zipPath ? path.resolve(rootDir, row.zipPath) : null;
    return {
      index: row.i,
      i: row.i,
      chainId: row.chainId,
      chainName: row.chainName,
      mode: row.mode,
      requestedBlock: row.requestedBlock,
      resolvedBlock: row.resolvedBlock,
      status: row.status,
      qaStatus: row.qaStatus || null,
      attempts: Number(row.attempts || 1),
      bundleDir: row.bundleDir,
      zipPath: row.zipPath,
      zipSha256: zipAbsolutePath ? sha256File(zipAbsolutePath) : null,
      zipHash: zipAbsolutePath ? sha256File(zipAbsolutePath) : null,
      gatePath: row.gatePath || null,
      logPath: row.logPath || null,
      manifestPath: row.manifestPath || null
    };
  });

  const outputHashes = {
    indexJsonSha256: sha256File(indexPaths.indexJsonPath),
    indexMdSha256: sha256File(indexPaths.indexMdPath),
    readmeSha256: sha256File(batchReadmePath)
  };

  const toolVersions = {
    node: process.version,
    npm: getVersion("npm", ["-v"]),
    slither: getVersion("slither", ["--version"]),
    mythril: getVersion("myth", ["--version"]),
    forge: getVersion("forge", ["--version"]),
    ollama: getVersion("ollama", ["--version"])
  };

  const failedCount = rows.filter((row) => row.status === "failed").length;
  const passed = failedCount === 0;
  const topRisks = collectBatchTopRisks(rows, 5);
  const preflightPath = path.join(rootDir, "preflight.json");
  const preflightSummary = readJsonFile(preflightPath);
  const defaultPreflightRaw = {
    integrated: false,
    note: "Run npm run preflight before deliverable for strict policy enforcement."
  };
  const preflightRaw = preflightSummary || defaultPreflightRaw;
  const preflightNormalized = preflightRaw && preflightRaw.normalized
    ? preflightRaw.normalized
    : {
      passed: null,
      targetCount: 0,
      rpcGrades: [],
      strictFlags: [],
      warnings: []
    };
  const rpcGrades = Array.isArray(preflightNormalized.rpcGrades) ? preflightNormalized.rpcGrades : [];
  const avgRpcGrade = rpcGrades.length
    ? rpcGrades.reduce((sum, row) => {
      const grade = String((row && row.rpcGrade) || "C").toUpperCase();
      const score = grade === "A" ? 4 : (grade === "B" ? 3 : (grade === "C" ? 2 : 1));
      return sum + score;
    }, 0) / rpcGrades.length
    : 0;
  const topSeverityByRiskScore = (function resolveTopSeverity() {
    const top = topRisks && topRisks.length > 0 ? topRisks[0] : null;
    if (!top) return "NONE";
    const score = Number(top.riskScore || 0);
    if (score >= 85) return "CRITICAL";
    if (score >= 70) return "HIGH";
    if (score >= 40) return "MEDIUM";
    if (score > 0) return "LOW";
    return "NONE";
  })();

  const manifest = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    passed,
    clientId: options.client || "unknown-client",
    engagementId: options.engagement || "unknown-engagement",
    client: options.client || null,
    engagement: options.engagement || null,
    intake: {
      path: options.intakePath,
      sha256: intakeHash,
      schemaVersion: intakeSchemaVersion,
      targetCount: intake && intake.targetCount ? intake.targetCount : rows.length
    },
    batch: {
      continueOnError: options.batchContinueOnError,
      failFast: options.batchFailFast,
      retry: options.batchRetry,
      retryBackoffMs: options.batchRetryBackoffMs,
      parallel: options.batchParallel,
      redact: options.redact
    },
    preflight: {
      integrated: Boolean(preflightRaw && preflightRaw.integrated),
      normalized: preflightNormalized,
      raw: preflightRaw
    },
    preflightHash: fs.existsSync(preflightPath) ? sha256File(preflightPath) : null,
    tools: toolVersions,
    outputHashes,
    targets: targetHashes,
    topRisks,
    metrics: {
      batch_duration_ms: Math.max(0, Date.now() - Number(batchStartMs || Date.now())),
      targets_total: rows.length,
      targets_passed: rows.filter((row) => row.status === "success").length,
      targets_flaked: rows.filter((row) => Number(row.attempts || 0) > 1).length,
      avg_rpc_grade: Number(avgRpcGrade.toFixed(4)),
      top_risk_severity: topSeverityByRiskScore,
      archive_success: false
    }
  };

  const manifestPath = path.join(rootDir, "engagement.manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

function appendDeliveryStatusToBatchIndex(rootDir, archiveInfo, notificationInfo) {
  const indexMdPath = path.join(rootDir, "index.md");
  if (!fs.existsSync(indexMdPath)) {
    return;
  }

  const archiveLine = archiveInfo && archiveInfo.url
    ? `- Archive: [${path.basename(archiveInfo.rootZipPath || "bundle.zip")}](${archiveInfo.url})`
    : "- Archive: N/A";
  const notifyLine = notificationInfo
    ? `- Notified: ${notificationInfo.to} (messageId=${notificationInfo.messageId || "N/A"})`
    : "- Notified: N/A";

  const deliverySection = [
    "",
    "## Delivery Status",
    "",
    archiveLine,
    notifyLine,
    ""
  ].join("\n");

  fs.appendFileSync(indexMdPath, deliverySection, "utf8");
}

function writeLatestBundlePointer(rootDir, options) {
  const bundlesRoot = path.dirname(rootDir);
  const latestPath = path.join(bundlesRoot, "LATEST.json");
  const payload = {
    batchRoot: path.basename(rootDir),
    absolutePath: rootDir,
    clientId: options.client || "unknown-client",
    engagementId: options.engagement || "unknown-engagement",
    generatedAt: new Date().toISOString()
  };
  fs.writeFileSync(latestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return latestPath;
}

function buildChildArgs(options, intakePath, targetIndex, bundleDir, zipPath) {
  const args = [
    __filename,
    "--intake",
    intakePath,
    `--intake-target-index=${targetIndex}`,
    `--bundle=${bundleDir}`,
    `--zip=${zipPath}`,
    "--print-gate-json"
  ];

  if (options.redact) args.push("--redact");
  if (options.usd) args.push("--usd");
  if (options.risk) args.push("--risk");
  if (options.reportHtml) args.push("--report-html");
  if (options.reportMd) args.push("--report-md");
  if (options.json) args.push("--json");
  if (options.csv) args.push("--csv");
  if (options.security) args.push("--security");
  if (options.ai) args.push("--ai");

  if (options.failOnAiHigh) args.push("--fail-on-ai-high");
  if (options.requireSecurity) args.push("--require-security");
  if (options.requireBlock) args.push("--require-block");
  if (options.requireArchive) args.push("--require-archive");
  if (options.strict) args.push("--strict");
  if (options.allowPartialSecurity) args.push("--allow-partial-security");
  if (!options.recommendArchiveRpc) args.push("--no-recommend-archive-rpc");
  if (!options.failOnHigh) args.push("--no-fail-on-high");
  if (options.failOnSecuritySkip) args.push("--fail-on-security-skip");
  if (options.gateMode === "warn") args.push("--gate-mode=warn");
  if (Number.isInteger(options.failOnMediumCount)) args.push(`--fail-on-medium-count=${options.failOnMediumCount}`);
  if (options.aiUrl) args.push(`--ai-url=${options.aiUrl}`);
  if (options.aiModel) args.push(`--ai-model=${options.aiModel}`);
  if (options.client) args.push(`--client=${options.client}`);
  if (options.engagement) args.push(`--engagement=${options.engagement}`);

  return args;
}

async function runIntakeBatch(options, argv) {
  const batchStartMs = Date.now();
  const intake = loadIntakeFile(options.intakePath);
  const rootDir = getBatchBundleRoot(options);
  const targetsRoot = path.join(rootDir, "targets");
  fs.mkdirSync(rootDir, { recursive: true });
  fs.mkdirSync(targetsRoot, { recursive: true });

  if (options.batchParallel > 1) {
    console.warn(`--batch-parallel=${options.batchParallel} requested; current implementation runs sequentially (parallel reserved for a future release).`);
  }

  if (options.batchPreflight) {
    console.log("----------------------------------------");
    console.log("Batch preflight: running");
    const preflightRun = runBatchPreflight(options, rootDir);
    console.log(`Batch preflight output: ${preflightRun.preflightPath}`);

    if (!preflightRun.summary.passed) {
      if (options.strict || options.batchFailFast) {
        throw new Error(`Batch preflight failed. See ${preflightRun.preflightPath}`);
      }
      console.warn("Batch preflight failed but continuing due to continue-on-error policy.");
    }
  } else {
    const preflightPath = path.join(rootDir, "preflight.json");
    const skippedPayload = {
      integrated: false,
      passed: true,
      skipped: true,
      reason: "batch preflight disabled via --batch-preflight 0"
    };
    fs.writeFileSync(preflightPath, `${JSON.stringify(skippedPayload, null, 2)}\n`, "utf8");
  }

  const targetRows = [];
  let skippedRemainder = false;
  for (let i = 0; i < intake.targets.length; i++) {
    const target = intake.targets[i];
    const requestedRuntime = await resolveTargetRuntime(target, options.rpc);
    const initialLabel = targetLabel(target, i, requestedRuntime.resolvedBlock, requestedRuntime.chainName);
    let bundleDir = path.join(targetsRoot, initialLabel);
    fs.mkdirSync(bundleDir, { recursive: true });

    const initialZipFileName = buildBatchZipFileName(
      options,
      target,
      requestedRuntime.chainName,
      requestedRuntime.mode,
      requestedRuntime.resolvedBlock
    );

    let zipPath = path.join(bundleDir, initialZipFileName);
    let logPath = path.join(bundleDir, "run.log");
    let gatePath = path.join(bundleDir, "gate.json");

    if (skippedRemainder) {
      targetRows.push({
        i: i + 1,
        status: "skipped",
        exitCode: null,
        reason: "skipped due to fail-fast after previous target failure",
        durationMs: 0,
        chainId: requestedRuntime.chainId,
        chainName: requestedRuntime.chainName,
        mode: requestedRuntime.mode,
        requestedBlock: requestedRuntime.requestedBlock,
        resolvedBlock: requestedRuntime.resolvedBlock,
        bundleDir: path.relative(rootDir, bundleDir).replace(/\\/g, "/"),
        zipPath: path.relative(rootDir, zipPath).replace(/\\/g, "/"),
        gatePath: path.relative(rootDir, gatePath).replace(/\\/g, "/"),
        logPath: path.relative(rootDir, logPath).replace(/\\/g, "/"),
        manifestPath: null,
        partialSecurity: false,
        marketCount: 0,
        collateralTokenCount: 0,
        topRiskTokens: []
      });
      continue;
    }

    const childArgs = buildChildArgs(options, options.intakePath, i, bundleDir, zipPath);

    console.log("----------------------------------------");
    console.log(`Batch target ${i + 1}/${intake.targets.length}`);
    console.log(`Bundle dir: ${bundleDir}`);

    const maxAttempts = Math.max(1, Number(options.batchRetry) || 1);
    const backoffBaseMs = Math.max(0, Number(options.batchRetryBackoffMs) || 0);
    const attemptLogs = [];
    let result = null;
    let durationMs = 0;
    let finalQa = { ok: false, reason: "child did not run" };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptStart = Date.now();
      result = spawnSync(process.execPath, childArgs, {
        encoding: "utf8",
        env: process.env,
        maxBuffer: 10 * 1024 * 1024
      });
      durationMs += Date.now() - attemptStart;

      const stdout = result.stdout || "";
      const stderr = result.stderr || "";
      const combinedOutput = `${stdout}\n${stderr}`;
      const transient = result.status !== 0 && isTransientBatchError(combinedOutput);
      finalQa = result.status === 0
        ? verifyTargetArtifacts(bundleDir, options.security, path.basename(zipPath), options.redact)
        : { ok: false, reason: `child exited with code ${result.status}` };

      attemptLogs.push([
        `## attempt ${attempt}/${maxAttempts}`,
        `exitCode: ${result.status}`,
        `qa: ${finalQa.ok ? "pass" : "fail"}`,
        `qaReason: ${finalQa.reason}`,
        `transient: ${transient}`,
        "",
        "### stdout",
        stdout,
        "",
        "### stderr",
        stderr,
        ""
      ].join("\n"));

      if (stdout) {
        process.stdout.write(stdout);
      }
      if (stderr) {
        process.stderr.write(stderr);
      }

      const gateJson = parseGateJsonFromOutput(combinedOutput);
      if (gateJson) {
        fs.writeFileSync(gatePath, `${JSON.stringify(gateJson, null, 2)}\n`, "utf8");
      }

      const shouldRetry = attempt < maxAttempts && result.status !== 0 && transient;
      if (!shouldRetry) {
        break;
      }

      const delayMs = backoffBaseMs * attempt;
      if (delayMs > 0) {
        console.warn(`Transient failure on target ${i + 1}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxAttempts})`);
        await sleepMs(delayMs);
      }
    }

    const logBody = [
      `# command`,
      `${process.execPath} ${childArgs.join(" ")}`,
      "",
      ...attemptLogs
    ].join("\n");
    fs.writeFileSync(logPath, `${logBody}\n`, "utf8");

    const manifestPath = path.join(bundleDir, "manifest.json");
    const summary = fs.existsSync(manifestPath) ? readManifestSummary(manifestPath) : null;
    const finalResolvedBlock = summary && Number.isInteger(summary.block)
      ? summary.block
      : requestedRuntime.resolvedBlock;
    const finalLabel = targetLabel(target, i, finalResolvedBlock, requestedRuntime.chainName);
    if (finalLabel !== path.basename(bundleDir)) {
      const renamedBundleDir = path.join(targetsRoot, finalLabel);
      if (!fs.existsSync(renamedBundleDir)) {
        fs.renameSync(bundleDir, renamedBundleDir);
        bundleDir = renamedBundleDir;
        zipPath = path.join(bundleDir, path.basename(zipPath));
        logPath = path.join(bundleDir, "run.log");
        gatePath = path.join(bundleDir, "gate.json");
      }
    }

    const finalMode = summary && summary.modeResolved
      ? String(summary.modeResolved)
      : requestedRuntime.mode;
    const finalZipFileName = buildBatchZipFileName(
      options,
      target,
      requestedRuntime.chainName,
      finalMode,
      finalResolvedBlock
    );
    const finalZipPath = path.join(bundleDir, finalZipFileName);
    if (fs.existsSync(zipPath) && zipPath !== finalZipPath) {
      if (!fs.existsSync(finalZipPath)) {
        fs.renameSync(zipPath, finalZipPath);
      }
      zipPath = finalZipPath;
    }

    const finalManifestPath = path.join(bundleDir, "manifest.json");
    const finalSummary = fs.existsSync(finalManifestPath) ? readManifestSummary(finalManifestPath) : summary;
    const auditSummary = readAuditSummary(bundleDir);
    const qaResult = verifyTargetArtifacts(bundleDir, options.security, path.basename(zipPath), options.redact);
    const status = result && result.status === 0 && qaResult.ok ? "success" : "failed";
    const reason = status === "success"
      ? "completed"
      : (qaResult.ok
        ? (result && result.error ? String(result.error.message || result.error) : `child exited with code ${result ? result.status : "unknown"}`)
        : qaResult.reason);

    const topRiskTokens = Array.isArray(auditSummary && auditSummary.tokens)
      ? [...auditSummary.tokens]
        .sort((a, b) => Number(b.riskScore || 0) - Number(a.riskScore || 0))
        .slice(0, 5)
        .map((row) => ({
          symbol: row.symbol,
          address: row.address,
          riskScore: Number(row.riskScore || 0),
          exposurePct: Number(row.exposurePct || 0)
        }))
      : [];

    targetRows.push({
      i: i + 1,
      status,
      exitCode: result ? result.status : null,
      reason,
      durationMs,
      attempts: attemptLogs.length,
      qaStatus: qaResult.ok ? "ok" : "failed",
      chainId: finalSummary && finalSummary.chainId ? finalSummary.chainId : requestedRuntime.chainId,
      chainName: finalSummary && finalSummary.network ? finalSummary.network : requestedRuntime.chainName,
      vault: finalSummary && finalSummary.vault ? finalSummary.vault : normalizeAddress(target.vault || ""),
      mode: finalSummary && finalSummary.modeResolved ? finalSummary.modeResolved : requestedRuntime.mode,
      requestedBlock: requestedRuntime.requestedBlock,
      resolvedBlock: finalResolvedBlock,
      bundleDir: path.relative(rootDir, bundleDir).replace(/\\/g, "/"),
      zipPath: path.relative(rootDir, zipPath).replace(/\\/g, "/"),
      gatePath: path.relative(rootDir, gatePath).replace(/\\/g, "/"),
      logPath: path.relative(rootDir, logPath).replace(/\\/g, "/"),
      manifestPath: fs.existsSync(finalManifestPath) ? path.relative(rootDir, finalManifestPath).replace(/\\/g, "/") : null,
      gatePassed: finalSummary ? finalSummary.gatePassed : null,
      partialSecurity: finalSummary ? finalSummary.partialSecurity : false,
      marketCount: auditSummary && auditSummary.summary ? Number(auditSummary.summary.v2Markets || 0) : 0,
      collateralTokenCount: auditSummary && auditSummary.summary
        ? Number(auditSummary.summary.v2CollateralTokens || auditSummary.summary.totalTokens || 0)
        : 0,
      topRiskTokens,
      securityStatus: finalSummary && finalSummary.partialSecurity
        ? "partial"
        : (options.security ? "ok" : "skipped")
    });

    if (status === "failed" && options.batchFailFast) {
      skippedRemainder = true;
    }
  }

  const indexPaths = writeBatchIndex(rootDir, targetRows);
  const batchReadmePath = writeBatchReadme(rootDir, targetRows);
  const engagementManifestPath = writeEngagementManifest(rootDir, options, intake, targetRows, indexPaths, batchReadmePath, batchStartMs);
  let archiveInfo = null;
  let notificationInfo = null;

  if (options.batchArchive) {
    console.log("----------------------------------------");
    console.log(`Archiving batch root to ${options.batchArchive}`);
    archiveInfo = await archiveBatchRoot(rootDir, options);
    console.log(`Archive URL: ${archiveInfo.url || "N/A"}`);
    console.log(`Archive SHA256: ${archiveInfo.rootZipSha256}`);
  }

  if (options.batchNotify) {
    console.log("----------------------------------------");
    console.log(`Sending batch notification to ${options.batchNotify}`);
    notificationInfo = await sendBatchNotification(options, archiveInfo, rootDir, engagementManifestPath);
    console.log(`Notification message id: ${notificationInfo && notificationInfo.messageId ? notificationInfo.messageId : "N/A"}`);
  }

  patchEngagementManifestWithDelivery(engagementManifestPath, archiveInfo, notificationInfo);
  appendDeliveryStatusToBatchIndex(rootDir, archiveInfo, notificationInfo);
  const latestPointerPath = writeLatestBundlePointer(rootDir, options);

  console.log("----------------------------------------");
  console.log(`Batch root: ${rootDir}`);
  console.log(`Batch index (md): ${indexPaths.indexMdPath}`);
  console.log(`Batch index (json): ${indexPaths.indexJsonPath}`);
  console.log(`Batch README: ${batchReadmePath}`);
  console.log(`Engagement manifest: ${engagementManifestPath}`);
  console.log(`Latest pointer: ${latestPointerPath}`);

  const failureCount = targetRows.filter((row) => row.status === "failed").length;
  if (failureCount > 0 && !options.batchContinueOnError) {
    throw new Error(`Batch completed with ${failureCount} failed target(s). See ${indexPaths.indexMdPath}`);
  }
}

function zipDirectory(sourceDir, outputZipPath) {
  return new Promise((resolve, reject) => {
    const resolvedSource = path.resolve(process.cwd(), sourceDir);
    const resolvedOutput = path.resolve(process.cwd(), outputZipPath);

    fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });

    const output = fs.createWriteStream(resolvedOutput);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve(resolvedOutput));
    output.on("error", (err) => reject(err));
    archive.on("error", (err) => reject(err));

    archive.pipe(output);
    archive.directory(resolvedSource, false);
    archive.finalize();
  });
}

function applyBundlePaths(options, networkName, blockNumber) {
  if (!options.bundle) {
    options.securityOutputDir = path.resolve(process.cwd(), "outputs/security");
    options.evidencePath = path.resolve(process.cwd(), "outputs/manifest.json");
    return;
  }

  const vaultPart = sanitizeForPath(options.vault.toLowerCase());
  const netPart = sanitizeForPath(networkName || "unknown");
  const blockPart = sanitizeForPath(String(blockNumber));
  const datePart = getDateStamp();
  const labelParts = [];
  if (options.client) {
    labelParts.push(sanitizeForPath(options.client));
  }
  if (options.engagement) {
    labelParts.push(sanitizeForPath(options.engagement));
  }
  const runName = [...labelParts, netPart, vaultPart, blockPart, datePart].join("_");
  const defaultDir = path.resolve(process.cwd(), "outputs/bundles", runName);

  const bundleDir = options.bundle === true
    ? defaultDir
    : path.resolve(process.cwd(), String(options.bundle));

  fs.mkdirSync(bundleDir, { recursive: true });
  options.bundleDir = bundleDir;
  options.securityOutputDir = path.join(bundleDir, "security");
  options.evidencePath = path.join(bundleDir, "manifest.json");

  if (!options._customCsvPath) {
    options.csvPath = path.join(bundleDir, "audit.csv");
  }
  if (!options._customJsonPath) {
    options.jsonPath = path.join(bundleDir, "audit.json");
  }
  if (!options._customReportHtml) {
    options.reportHtml = path.join(bundleDir, "report.html");
  }
  if (!options._customReportMd) {
    options.reportMd = path.join(bundleDir, "report.md");
  }
}

function redactRpc(value) {
  if (!value) return "N/A";
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
  } catch (_) {
    return "custom-rpc";
  }
}

function getGitCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return "unknown";
  }
  return (result.stdout || "").trim() || "unknown";
}

function sha256File(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function pathMaybeRelative(filePath, rootDir) {
  if (!filePath) return null;
  const resolved = path.resolve(process.cwd(), filePath);
  if (!rootDir) {
    return resolved;
  }
  return path.relative(rootDir, resolved).replace(/\\/g, "/");
}

function hashObject(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeSeverity(value) {
  const s = String(value || "").toUpperCase();
  if (s === "CRITICAL") return "CRITICAL";
  if (s === "HIGH") return "HIGH";
  if (s === "MEDIUM") return "MEDIUM";
  if (s === "LOW") return "LOW";
  if (s === "INFORMATIONAL" || s === "INFO") return "INFO";
  return "INFO";
}

function normalizeSecurityFindings(input) {
  const findings = [];
  const toolErrors = [];

  const registerToolState = (toolName, toolResult) => {
    if (!toolResult) {
      toolErrors.push({ tool: toolName, error: "missing-tool-result" });
      return;
    }
    if (toolResult.status === "skipped" || toolResult.status === "error") {
      toolErrors.push({
        tool: toolName,
        error: toolResult.reason || toolResult.status
      });
    }
  };

  registerToolState("slither", input.slitherResult);
  registerToolState("mythril", input.mythrilResult);
  registerToolState("gmx-detectors", input.customResult);

  if (input.slitherFile && fs.existsSync(input.slitherFile)) {
    try {
      const slither = JSON.parse(fs.readFileSync(input.slitherFile, "utf8"));
      const detectors = slither.results && Array.isArray(slither.results.detectors) ? slither.results.detectors : [];
      for (const detector of detectors) {
        findings.push({
          tool: "slither",
          severity: normalizeSeverity(detector.impact),
          check: detector.check || "unknown",
          title: detector.description || detector.check || "slither finding",
          evidence: {
            confidence: detector.confidence || "unknown"
          }
        });
      }
    } catch (_) {
      // Keep normalization resilient; raw file still available in outputs.
    }
  }

  if (input.mythrilFile && fs.existsSync(input.mythrilFile)) {
    try {
      const mythril = JSON.parse(fs.readFileSync(input.mythrilFile, "utf8"));
      const issues = Array.isArray(mythril.issues) ? mythril.issues : [];
      for (const issue of issues) {
        findings.push({
          tool: "mythril",
          severity: normalizeSeverity(issue.severity),
          check: issue.swcID || "MYTH-UNKNOWN",
          title: issue.title || "mythril finding",
          evidence: {
            swcId: issue.swcID || null,
            description: issue.description && issue.description.head ? issue.description.head : null
          }
        });
      }
    } catch (_) {
      // Keep normalization resilient; raw file still available in outputs.
    }
  }

  if (input.customFile && fs.existsSync(input.customFile)) {
    try {
      const custom = JSON.parse(fs.readFileSync(input.customFile, "utf8"));
      const entries = Array.isArray(custom.findings) ? custom.findings : [];
      for (const entry of entries) {
        findings.push({
          tool: "gmx-detectors",
          severity: normalizeSeverity(entry.severity),
          check: entry.id || "GMX-UNKNOWN",
          title: entry.title || "custom detector finding",
          evidence: {}
        });
      }
    } catch (_) {
      // Keep normalization resilient; raw file still available in outputs.
    }
  }

  return {
    findings,
    toolErrors
  };
}

function writeEvidenceManifest(input) {
  const hashes = [];
  for (const filePath of input.files) {
    const hash = sha256File(filePath);
    if (hash) {
      hashes.push({
        file: pathMaybeRelative(filePath, input.bundleRoot),
        sha256: hash
      });
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    vault: input.vault,
    network: input.network,
    block: input.block,
    rpc: {
      rawRedacted: redactRpc(input.rpc)
    },
    rerun: {
      command: input.command,
      notes: "Use same RPC class and block for deterministic replay"
    },
    redaction: input.redaction || null,
    modes: input.modes,
    gate: input.gate,
    git: {
      commit: getGitCommit()
    },
    inputs: {
      scriptFile: pathMaybeRelative(input.scriptFile, input.bundleRoot),
      scriptSha256: sha256File(input.scriptFile),
      feedConfigSha256: input.feedConfigSha256
    },
    tools: {
      node: process.version,
      npm: getVersion("npm", ["-v"]),
      slither: getVersion("slither", ["--version"]),
      mythril: getVersion("myth", ["--version"]),
      foundryCast: getVersion("cast", ["--version"]),
      forge: getVersion("forge", ["--version"])
    },
    security: input.security ? {
      manifestPath: pathMaybeRelative(input.security.manifestPath, input.bundleRoot),
      highFindings: input.security.highFindings,
      partial: Boolean(input.security.partial),
      archiveCapable: input.security.archiveCapable === null || input.security.archiveCapable === undefined
        ? null
        : Boolean(input.security.archiveCapable),
      rpcHostRedacted: redactRpc(input.rpc)
    } : null,
    ai: input.ai ? {
      status: input.ai.status || "ok",
      model: input.ai.model || "unknown",
      findingCount: Array.isArray(input.ai.ai_findings) ? input.ai.ai_findings.length : 0,
      schemaValid: Boolean(input.ai.schema_valid),
      cacheHit: Boolean(input.ai.cache_hit)
    } : null,
    outputHashes: hashes
  };

  const resolvedPath = path.resolve(process.cwd(), input.manifestPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return resolvedPath;
}

function applyGate(mode, reasons) {
  const activeReasons = reasons.filter(Boolean);
  if (activeReasons.length === 0) {
    return {
      passed: true,
      reasons: []
    };
  }

  if (mode === "warn") {
    for (const reason of activeReasons) {
      console.warn(`Gate warning: ${reason}`);
    }
    return {
      passed: true,
      reasons: activeReasons
    };
  }

  return {
    passed: false,
    reasons: activeReasons
  };
}

function toBlockTag(blockInput) {
  if (blockInput === undefined || blockInput === null || String(blockInput).toLowerCase() === "latest") {
    return "latest";
  }

  const normalized = Number(blockInput);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new Error("Invalid --block value. Use a positive integer or 'latest'");
  }
  return normalized;
}

function detectType(symbol, name) {
  const s = String(symbol || "").toUpperCase();
  const n = String(name || "").toUpperCase();

  if (STABLE_SYMBOLS.has(s)) return "Stablecoin";
  if (s.includes("LP") || n.includes("LP")) return "LP Token";
  if (s.includes("WETH") || s.includes("WBTC") || s.includes("WAVAX")) return "Wrapped";
  return "Standard";
}

async function withTimeout(promise, ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return promise;
  }

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`RPC call timed out after ${ms}ms`)), ms);
    })
  ]);
}

async function safeCall(contract, method, args, fallback, blockTag) {
  try {
    const fn = contract.getFunction(method);
    if (typeof fn === "function" && typeof fn.staticCall === "function") {
      const overrides = blockTag === undefined || blockTag === null || blockTag === "latest"
        ? []
        : [{ blockTag }];
      return await withTimeout(fn.staticCall(...args, ...overrides), RPC_CALL_TIMEOUT_MS);
    }
    return await withTimeout(callContractMethod(contract, method, args, blockTag), RPC_CALL_TIMEOUT_MS);
  } catch (_) {
    return fallback;
  }
}

async function retryRead(callable, attempts = 2) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await callable();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Read failed");
}

function decodeBytes32Text(value) {
  if (typeof value !== "string") {
    return null;
  }

  const lowered = value.toLowerCase();
  if (
    lowered === "0x0000000000000000000000000000000000000000000000000000000000000020" ||
    lowered === "0x0000000000000000000000000000000000000000000000000000000000000040"
  ) {
    return null;
  }

  try {
    const decoded = ethers.decodeBytes32String(value);
    return decoded.trim() || null;
  } catch (_) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
      return null;
    }

    try {
      const text = Buffer.from(value.slice(2), "hex").toString("utf8").replace(/\u0000/g, "").trim();
      return text || null;
    } catch (_) {
      return null;
    }
  }
}

function sanitizeTokenText(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

async function readTokenStringMetadata(tokenAddress, provider, method, blockTag) {
  const stringContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const readStringAt = async (tag) => {
    try {
      const value = await retryRead(() => callContractMethod(stringContract, method, [], tag));
      return sanitizeTokenText(value);
    } catch (_) {
      return null;
    }
  };

  const primaryString = await readStringAt(blockTag);
  if (primaryString) {
    return primaryString;
  }

  if (blockTag !== undefined && blockTag !== null && blockTag !== "latest") {
    const latestString = await readStringAt("latest");
    if (latestString) {
      return latestString;
    }
  }

  const bytes32Contract = new ethers.Contract(tokenAddress, ERC20_BYTES32_METADATA_ABI, provider);
  const readBytes32At = async (tag) => {
    try {
      const value = await retryRead(() => callContractMethod(bytes32Contract, method, [], tag));
      return sanitizeTokenText(decodeBytes32Text(value));
    } catch (_) {
      return null;
    }
  };

  const primaryBytes32 = await readBytes32At(blockTag);
  if (primaryBytes32) {
    return primaryBytes32;
  }

  if (blockTag !== undefined && blockTag !== null && blockTag !== "latest") {
    const latestBytes32 = await readBytes32At("latest");
    if (latestBytes32) {
      return latestBytes32;
    }
  }

  return "N/A";
}

async function readTokenMetadata(tokenAddress, provider, blockTag, metadataOverrides) {
  const normalizedAddress = normalizeAddress(tokenAddress || "");
  const override = normalizedAddress && metadataOverrides
    ? metadataOverrides[normalizedAddress.toLowerCase()] || null
    : null;
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

  const readWithLatestFallback = async (method, fallback) => {
    try {
      return await retryRead(() => callContractMethod(token, method, [], blockTag));
    } catch (_) {
      if (blockTag !== undefined && blockTag !== null && blockTag !== "latest") {
        try {
          return await retryRead(() => callContractMethod(token, method, [], "latest"));
        } catch (_) {
        }
      }
      return fallback;
    }
  };

  if (override) {
    const totalSupplyRaw = await readWithLatestFallback("totalSupply", 0n);
    return {
      token,
      symbol: override.symbol,
      name: override.name,
      decimals: Number(override.decimals),
      totalSupplyRaw,
      metadataSource: "config"
    };
  }

  const [symbol, name, decimalsRaw, totalSupplyRaw] = await Promise.all([
    readTokenStringMetadata(tokenAddress, provider, "symbol", blockTag),
    readTokenStringMetadata(tokenAddress, provider, "name", blockTag),
    readWithLatestFallback("decimals", 18),
    readWithLatestFallback("totalSupply", 0n)
  ]);

  return {
    token,
    symbol,
    name,
    decimals: Number(decimalsRaw),
    totalSupplyRaw,
    metadataSource: "onchain"
  };
}

function formatUnitsSafe(value, decimals) {
  if (value === null || value === undefined) return "N/A";
  try {
    return ethers.formatUnits(value, Number(decimals));
  } catch (_) {
    return String(value);
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/\"/g, '""')}"`;
  }
  return text;
}

function writeCsv(filePath, rows) {
  const header = [
    "index",
    "address",
    "symbol",
    "name",
    "decimals",
    "type",
    "vaultBalance",
    "totalSupply",
    "priceUsd",
    "vaultValueUsd",
    "priceUpdatedAt",
    "priceStale",
    "isStablecoin",
    "hasFeed",
    "isLpToken",
    "exposurePct",
    "riskScore",
    "metadataOk",
    "metadataSource",
    "hasPrice"
  ];

  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(header.map((field) => csvEscape(row[field])).join(","));
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${lines.join("\n")}\n`, "utf8");
  return resolvedPath;
}

function toNumberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function computeTokenRisk(row, totalExposureBase) {
  let riskScore = 0;

  const isStablecoin = row.type === "Stablecoin";
  const isLpToken = row.type === "LP Token";
  const hasFeed = row.hasPrice;
  const decimalsAnomaly = !Number.isFinite(row.decimals) || row.decimals < 6 || row.decimals > 18;

  const exposureBase = row.vaultValueUsd === "N/A" ? toNumberOrZero(row.vaultBalance) : toNumberOrZero(row.vaultValueUsd);
  const exposurePct = totalExposureBase > 0 ? (exposureBase / totalExposureBase) * 100 : 0;

  if (!isStablecoin) riskScore += 2;
  if (decimalsAnomaly) riskScore += 1;
  if (exposurePct > 30) riskScore += 3;
  if (!hasFeed || row.priceStale === true) riskScore += 2;
  if (isLpToken) riskScore += 2;

  return {
    isStablecoin,
    hasFeed,
    isLpToken,
    exposurePct,
    riskScore: Math.min(10, riskScore)
  };
}

async function getWhitelistedTokenAddresses(vault, blockTag) {
  const lenAll = await safeCall(vault, "allWhitelistedTokensLength", [], null, blockTag);
  if (lenAll !== null) {
    const length = Number(lenAll);
    return Promise.all(Array.from({ length }, (_, i) => callContractMethod(vault, "allWhitelistedTokens", [i], blockTag)));
  }

  const lenLegacy = await safeCall(vault, "whitelistedTokenCount", [], null, blockTag);
  if (lenLegacy !== null) {
    const length = Number(lenLegacy);
    return Promise.all(Array.from({ length }, (_, i) => callContractMethod(vault, "whitelistedTokens", [i], blockTag)));
  }

  throw new Error(
    "Vault ABI mismatch: target does not expose v1 whitelist getters. If this is GMX v2, use a DataStore/Reader-based workflow."
  );
}

function normalizeMarketProp(market) {
  const marketToken = normalizeAddress(market && (market.marketToken || market[0]));
  const indexToken = normalizeAddress(market && (market.indexToken || market[1]));
  const longToken = normalizeAddress(market && (market.longToken || market[2]));
  const shortToken = normalizeAddress(market && (market.shortToken || market[3]));

  return {
    marketToken,
    indexToken,
    longToken,
    shortToken
  };
}

function dedupeAddresses(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeAddress(value || "");
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function createTokenSnapshotLoader(params) {
  const cache = new Map();

  return async function getTokenSnapshot(tokenAddress) {
    const normalized = normalizeAddress(tokenAddress || "");
    if (!normalized) {
      return null;
    }

    const key = normalized.toLowerCase();
    if (cache.has(key)) {
      return cache.get(key);
    }

    const promise = (async () => {
      const { token, symbol, decimals, name, totalSupplyRaw, metadataSource } = await readTokenMetadata(
        normalized,
        params.provider,
        params.blockTag,
        params.metadataOverrides
      );

      let priceInfo = {
        priceUsd: null,
        hasPrice: false,
        updatedAt: null,
        stale: null
      };

      if (params.includePrices) {
        priceInfo = await getPriceInfo(
          params.provider,
          params.chainId,
          normalized,
          params.blockTag,
          params.blockTimestamp,
          params.maxStaleSeconds,
          params.feedMap
        );
      }

      return {
        address: normalized,
        token,
        symbol,
        decimals: Number(decimals),
        name,
        totalSupplyRaw,
        totalSupply: formatUnitsSafe(totalSupplyRaw, decimals),
        metadataOk: symbol !== "N/A" && name !== "N/A",
        metadataSource,
        type: detectType(symbol, name),
        hasPrice: priceInfo.hasPrice && priceInfo.priceUsd !== null,
        priceInfo
      };
    })();

    cache.set(key, promise);
    return promise;
  };
}

async function buildV2MarketContext(params) {
  const getTokenSnapshot = createTokenSnapshotLoader({
    provider: params.provider,
    chainId: params.chainId,
    blockTag: params.blockTag,
    blockTimestamp: params.blockTimestamp,
    maxStaleSeconds: params.maxStaleSeconds,
    feedMap: params.feedMap,
    includePrices: params.includePrices,
    metadataOverrides: params.metadataOverrides
  });

  const collateralExposure = new Map();

  function addCollateralExposure(snapshot, rawBalance, usdValue, marketToken) {
    if (!snapshot) {
      return;
    }

    const key = snapshot.address.toLowerCase();
    if (!collateralExposure.has(key)) {
      collateralExposure.set(key, {
        snapshot,
        rawBalance: 0n,
        usdValue: 0,
        marketRefs: new Set()
      });
    }

    const entry = collateralExposure.get(key);
    entry.rawBalance += rawBalance || 0n;
    if (Number.isFinite(usdValue)) {
      entry.usdValue += usdValue;
    }
    entry.marketRefs.add(String(marketToken));
  }

  async function processBatch(items, fn, batchSize) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const start = i + 1;
      const end = Math.min(i + batchSize, items.length);
      process.stderr.write(`[v2] Processing markets ${start}-${end} / ${items.length}\n`);
      const batchResults = await Promise.all(batch.map((item, j) => fn(item, i + j)));
      results.push(...batchResults);
    }
    return results;
  }

  const RPC_BATCH_SIZE = 10;
  const preliminaryMarkets = await processBatch(params.markets, async (market, index) => {
    const [indexSnapshot, longSnapshot, shortSnapshot] = await Promise.all([
      isZeroAddress(market.indexToken) ? null : getTokenSnapshot(market.indexToken),
      getTokenSnapshot(market.longToken),
      getTokenSnapshot(market.shortToken)
    ]);

    const [longBalanceRaw, shortBalanceRaw] = await Promise.all([
      longSnapshot ? safeCall(longSnapshot.token, "balanceOf", [market.marketToken], 0n, params.blockTag) : 0n,
      shortSnapshot ? safeCall(shortSnapshot.token, "balanceOf", [market.marketToken], 0n, params.blockTag) : 0n
    ]);

    const longBalance = formatUnitsSafe(longBalanceRaw, longSnapshot ? longSnapshot.decimals : 18);
    const shortBalance = formatUnitsSafe(shortBalanceRaw, shortSnapshot ? shortSnapshot.decimals : 18);
    const longBalanceNum = toNumberOrZero(longBalance);
    const shortBalanceNum = toNumberOrZero(shortBalance);

    const longUsd = longSnapshot && longSnapshot.priceInfo.priceUsd !== null
      ? longBalanceNum * longSnapshot.priceInfo.priceUsd
      : null;
    const shortUsd = shortSnapshot && shortSnapshot.priceInfo.priceUsd !== null
      ? shortBalanceNum * shortSnapshot.priceInfo.priceUsd
      : null;
    const marketValueUsd = (Number.isFinite(longUsd) ? longUsd : 0) + (Number.isFinite(shortUsd) ? shortUsd : 0);

    addCollateralExposure(longSnapshot, longBalanceRaw, longUsd, market.marketToken);
    addCollateralExposure(shortSnapshot, shortBalanceRaw, shortUsd, market.marketToken);

    return {
      index,
      marketToken: market.marketToken,
      indexToken: market.indexToken,
      longToken: market.longToken,
      shortToken: market.shortToken,
      hasIndexFeed: Boolean(indexSnapshot && indexSnapshot.hasPrice),
      indexFeedMissing: Boolean(indexSnapshot) && !indexSnapshot.hasPrice,
      longFeedMissing: Boolean(longSnapshot) && !longSnapshot.hasPrice,
      shortFeedMissing: Boolean(shortSnapshot) && !shortSnapshot.hasPrice,
      indexPriceStale: Boolean(indexSnapshot && indexSnapshot.priceInfo.stale === true),
      zeroLiquidity: longBalanceNum === 0 && shortBalanceNum === 0,
      longBalance,
      shortBalance,
      marketValueUsdNum: marketValueUsd
    };
  }, RPC_BATCH_SIZE);

  const totalMarketValueUsd = preliminaryMarkets.reduce((sum, row) => sum + (Number.isFinite(row.marketValueUsdNum) ? row.marketValueUsdNum : 0), 0);

  const marketRows = preliminaryMarkets.map((row) => {
    const concentrationPct = totalMarketValueUsd > 0 && Number.isFinite(row.marketValueUsdNum)
      ? (row.marketValueUsdNum / totalMarketValueUsd) * 100
      : 0;
    const riskFlags = [];
    let riskScore = 0;

    if (row.indexFeedMissing) {
      riskScore += 4;
      riskFlags.push("index token missing price feed");
    }
    if (row.longFeedMissing) {
      riskScore += 2;
      riskFlags.push("long token missing price feed");
    }
    if (row.shortFeedMissing) {
      riskScore += 2;
      riskFlags.push("short token missing price feed");
    }
    if (row.zeroLiquidity) {
      riskScore += 2;
      riskFlags.push("market token has zero liquidity");
    }
    if (row.indexPriceStale) {
      riskScore += 4;
      riskFlags.push("stale oracle on index token");
    }
    if (concentrationPct >= 50) {
      riskScore += 4;
      riskFlags.push(`top market concentration ${concentrationPct.toFixed(2)}%`);
    } else if (concentrationPct >= 25) {
      riskScore += 2;
      riskFlags.push(`elevated market concentration ${concentrationPct.toFixed(2)}%`);
    }

    return {
      index: row.index,
      marketToken: row.marketToken,
      indexToken: row.indexToken,
      longToken: row.longToken,
      shortToken: row.shortToken,
      hasIndexFeed: row.hasIndexFeed,
      longBalance: row.longBalance,
      shortBalance: row.shortBalance,
      marketValueUsd: formatFixedOrNA(row.marketValueUsdNum, 2),
      concentrationPct: concentrationPct.toFixed(2),
      indexFeedMissing: row.indexFeedMissing,
      longFeedMissing: row.longFeedMissing,
      shortFeedMissing: row.shortFeedMissing,
      indexPriceStale: row.indexPriceStale,
      zeroLiquidity: row.zeroLiquidity,
      riskFlags,
      riskScore: Math.min(10, riskScore)
    };
  });

  const collateralTokenRows = Array.from(collateralExposure.values()).map((entry, index) => {
    const balance = formatUnitsSafe(entry.rawBalance, entry.snapshot.decimals);

    return {
      index,
      address: entry.snapshot.address,
      symbol: entry.snapshot.symbol,
      name: entry.snapshot.name,
      decimals: entry.snapshot.decimals,
      type: entry.snapshot.type,
      vaultBalance: balance,
      balanceRaw: entry.rawBalance.toString(),
      balanceSource: "marketTokenHoldings",
      totalSupply: entry.snapshot.totalSupply,
      priceUsd: entry.snapshot.priceInfo.priceUsd === null ? "N/A" : entry.snapshot.priceInfo.priceUsd.toFixed(6),
      vaultValueUsd: entry.snapshot.priceInfo.priceUsd === null ? "N/A" : entry.usdValue.toFixed(2),
      priceUpdatedAt: entry.snapshot.priceInfo.updatedAt || "N/A",
      priceStale: entry.snapshot.priceInfo.stale === null ? "N/A" : entry.snapshot.priceInfo.stale,
      metadataOk: entry.snapshot.metadataOk,
      metadataSource: entry.snapshot.metadataSource,
      hasPrice: entry.snapshot.hasPrice,
      marketRefs: entry.marketRefs.size
    };
  });

  collateralTokenRows.sort((a, b) => {
    const delta = toNumberOrZero(b.vaultValueUsd === "N/A" ? b.vaultBalance : b.vaultValueUsd)
      - toNumberOrZero(a.vaultValueUsd === "N/A" ? a.vaultBalance : a.vaultValueUsd);
    if (delta !== 0) {
      return delta;
    }
    return a.address.localeCompare(b.address);
  });
  collateralTokenRows.forEach((row, index) => {
    row.index = index;
  });

  const topMarket = [...marketRows].sort((a, b) => toNumberOrZero(b.marketValueUsd) - toNumberOrZero(a.marketValueUsd))[0] || null;

  return {
    marketRows,
    collateralTokenRows,
    collateralTokens: collateralTokenRows.map((row) => row.address),
    marketSummary: {
      totalMarkets: marketRows.length,
      totalCollateralTokens: collateralTokenRows.length,
      missingIndexFeeds: marketRows.filter((row) => row.indexFeedMissing).length,
      missingCollateralFeeds: marketRows.filter((row) => row.longFeedMissing || row.shortFeedMissing).length,
      staleIndexFeeds: marketRows.filter((row) => row.indexPriceStale).length,
      zeroLiquidityMarkets: marketRows.filter((row) => row.zeroLiquidity).length,
      highRiskMarkets: marketRows.filter((row) => row.riskScore >= 6).length,
      totalMarketValueUsd: totalMarketValueUsd.toFixed(2),
      topMarketToken: topMarket ? topMarket.marketToken : "N/A",
      topMarketSharePct: topMarket ? topMarket.concentrationPct : "0.00"
    }
  };
}

function resolveV2Vaults(options, chainConfig) {
  const configV2 = chainConfig && chainConfig.gmxV2 ? chainConfig.gmxV2 : null;
  const values = [];

  if (options.v2Vault) {
    values.push(options.v2Vault);
  }

  if (options.vault) {
    values.push(options.vault);
  }

  if (configV2 && configV2.vault) {
    values.push(configV2.vault);
  }

  if (configV2 && Array.isArray(configV2.vaults)) {
    values.push(...configV2.vaults);
  }

  return dedupeAddresses(values);
}

async function getV2Markets(provider, dataStoreAddress, readerAddress, blockTag) {
  const reader = new ethers.Contract(readerAddress, READER_V2_ABI, provider);
  const dataStore = new ethers.Contract(dataStoreAddress, DATASTORE_VIEW_ABI, provider);

  let totalCount = await safeCall(dataStore, "getAddressCount", [MARKET_LIST_SET_KEY], null, blockTag);
  totalCount = totalCount === null ? null : Number(totalCount);

  const step = 200;
  let start = 0;
  const markets = [];

  while (true) {
    const end = totalCount === null ? start + step : Math.min(start + step, totalCount);
    const chunk = await safeCall(reader, "getMarkets", [dataStoreAddress, start, end], [], blockTag);
    if (!Array.isArray(chunk) || chunk.length === 0) {
      break;
    }

    for (const entry of chunk) {
      const normalized = normalizeMarketProp(entry);
      if (!normalized.marketToken || !normalized.longToken || !normalized.shortToken) {
        continue;
      }
      markets.push(normalized);
    }

    start += chunk.length;

    if (chunk.length < step) {
      break;
    }

    if (totalCount !== null && start >= totalCount) {
      break;
    }

    if (start > 5000) {
      break;
    }
  }

  return markets;
}

async function getPriceInfo(provider, chainId, tokenAddress, blockTag, blockTimestamp, maxStaleSeconds, feedMap) {
  const addressMap = feedMap || ADDRESS_PRICE_FEEDS[chainId] || {};
  const feedAddress = addressMap[String(tokenAddress).toLowerCase()];

  if (!feedAddress) {
    return {
      priceUsd: null,
      hasPrice: false,
      updatedAt: null,
      stale: null
    };
  }

  const feed = new ethers.Contract(feedAddress, CHAINLINK_ABI, provider);
  const [round, decimals] = await Promise.all([
    safeCall(feed, "latestRoundData", [], null, blockTag),
    safeCall(feed, "decimals", [], 8, blockTag)
  ]);

  if (!round || round[1] <= 0n) {
    return {
      priceUsd: null,
      hasPrice: true,
      updatedAt: null,
      stale: null
    };
  }

  const updatedAt = Number(round[3]);
  const stale = blockTimestamp > 0 && updatedAt > 0 ? (blockTimestamp - updatedAt) > maxStaleSeconds : null;
  const priceUsd = Number(round[1]) / (10 ** Number(decimals));

  return {
    priceUsd,
    hasPrice: true,
    updatedAt,
    stale
  };
}

function getVersion(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) {
    return "not-installed";
  }
  const output = (result.stdout || result.stderr || "").trim();
  return output || "unknown";
}

async function runSecurityPipeline(params) {
  const outputDir = path.resolve(process.cwd(), params.options.securityOutputDir || "outputs/security");
  fs.mkdirSync(outputDir, { recursive: true });
  const securityTarget = params.options.securityTarget || params.options.vault;

  let bytecode = null;
  let bytecodeHash = null;
  let bytecodeFile = null;
  let bytecodeFetchError = null;
  let archiveCapable = true;

  try {
    bytecode = await params.provider.getCode(securityTarget, params.blockNumber);
    bytecodeFile = path.join(outputDir, "vault.bytecode");
    fs.writeFileSync(bytecodeFile, bytecode, "utf8");
    bytecodeHash = crypto.createHash("sha256").update(bytecode).digest("hex");
  } catch (error) {
    bytecodeFetchError = error && error.message ? error.message : String(error);
    archiveCapable = isArchiveUnavailableError(error) ? false : null;
    if (params.options.requireArchive && isArchiveUnavailableError(error)) {
      throw new Error(
        `Archive RPC required for historical security scans at block ${params.blockNumber}. ${getArchiveRecommendationLine()}`
      );
    }
  }

  const slither = runSlitherScan({
    target: securityTarget,
    outputDir,
    rpcUrl: params.options.rpc
  });

  const mythril = runMythrilScan({
    target: securityTarget,
    outputDir,
    rpcUrl: params.options.rpc
  });

  const custom = bytecode
    ? runGmxDetectors({
      bytecode,
      outputDir
    })
    : {
      status: "skipped",
      reason: `bytecode unavailable at block ${params.blockNumber}: ${bytecodeFetchError || "unknown error"}`
    };

  const manifest = {
    timestamp: new Date().toISOString(),
    vault: params.options.vault,
    securityTarget,
    rpc: params.options.rpc,
    network: {
      name: params.network.name,
      chainId: Number(params.network.chainId)
    },
    block: {
      number: params.blockNumber,
      hash: params.blockHash,
      timestamp: params.blockTimestamp
    },
    bytecodeHash,
    tools: {
      node: process.version,
      slither: getVersion("slither", ["--version"]),
      mythril: getVersion("myth", ["--version"]),
      foundryCast: getVersion("cast", ["--version"])
    },
    results: {
      slither,
      mythril,
      custom
    },
    archive: {
      archiveCapable,
      rpcHostRedacted: redactRpc(params.options.rpc)
    },
    warnings: bytecodeFetchError ? [
      `bytecode fetch failed at block ${params.blockNumber}`,
      bytecodeFetchError,
      "Use an archive RPC endpoint for fully deterministic historical security scans"
    ] : []
  };

  const manifestPath = path.join(outputDir, "run.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const slitherFile = path.join(outputDir, "slither.json");
  const mythrilFile = path.join(outputDir, "mythril.json");
  const customFile = path.join(outputDir, "gmx-risks.json");

  const normalized = normalizeSecurityFindings({
    slitherFile,
    mythrilFile,
    customFile,
    slitherResult: slither,
    mythrilResult: mythril,
    customResult: custom
  });
  const normalizedFindings = normalized.findings;
  const toolErrors = normalized.toolErrors;
  const normalizedPath = path.join(outputDir, "findings.normalized.json");

  const severityCounts = normalizedFindings.reduce((acc, finding) => {
    const key = normalizeSeverity(finding.severity);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const partial = toolErrors.length > 0;

  fs.writeFileSync(normalizedPath, `${JSON.stringify({
    meta: {
      generatedAt: new Date().toISOString(),
      block: params.blockNumber,
      chainId: Number(params.network.chainId),
      securityRan: true,
      partial,
      tools: {
        slither: slither.status,
        mythril: mythril.status,
        custom: custom.status
      }
    },
    severityCounts,
    findings: normalizedFindings,
    toolErrors
  }, null, 2)}\n`, "utf8");

  const highFindings = Number(severityCounts.HIGH || 0);
  const outputFiles = [slitherFile, mythrilFile, customFile, normalizedPath, manifestPath];
  if (bytecodeFile) {
    outputFiles.unshift(bytecodeFile);
  }

  return {
    manifestPath,
    highFindings,
    results: manifest.results,
    severityCounts,
    partial: partial || Boolean(bytecodeFetchError),
    toolErrors,
    normalizedPath,
    outputFiles,
    warnings: manifest.warnings,
    archiveCapable,
    rpcHostRedacted: redactRpc(params.options.rpc)
  };
}

async function main() {
  const options = parseArgs(process.argv);

  if (options.intakePath && options.intakeTargetCount > 1 && options.intakeTargetIndex === null) {
    await runIntakeBatch(options, process.argv);
    console.log("\nBatch audit completed successfully");
    return;
  }

  const provider = new ethers.JsonRpcProvider(options.rpc);
  const network = await provider.getNetwork();
  const runtimeChainId = Number(network.chainId);
  const effectiveChainId = options.chainId || runtimeChainId;

  if (options.chainId && options.chainId !== runtimeChainId) {
    throw new Error(`--chain-id ${options.chainId} does not match RPC chainId ${runtimeChainId}`);
  }

  const { config: chainConfig, path: chainConfigPath } = loadChainConfig(effectiveChainId);
  const displayNetworkName = getDisplayNetworkName(network, chainConfig, effectiveChainId);
  const feedMap = mergeFeedMap(effectiveChainId, chainConfig);
  const tokenMetadataOverrides = buildTokenMetadataOverrides(chainConfig);
  const configV2 = chainConfig && chainConfig.gmxV2 ? chainConfig.gmxV2 : null;

  if (!options.dataStore && configV2 && configV2.dataStore) {
    options.dataStore = normalizeAddress(configV2.dataStore);
  }

  if (!options.reader && configV2 && configV2.reader) {
    options.reader = normalizeAddress(configV2.reader);
  }

  if (!options.v2Vault && configV2 && configV2.vault) {
    options.v2Vault = normalizeAddress(configV2.vault);
  }

  if (!options.vault && options.mode !== "v2" && chainConfig && chainConfig.gmxV1 && chainConfig.gmxV1.vault) {
    const configuredVault = normalizeAddress(chainConfig.gmxV1.vault);
    if (configuredVault) {
      options.vault = configuredVault;
    }
  }

  if (!options.vault && options.mode === "v2") {
    options.vault = options.v2Vault || options.reader || options.dataStore || null;
  }

  if (!options.vault || !ethers.isAddress(options.vault)) {
    if (options.mode === "v2") {
      throw new Error(
        "Mode v2 requires configured --reader and --datastore plus at least one vault (--v2-vault or gmxV2.vault/gmxV2.vaults)."
      );
    }
    const configHint = chainConfigPath
      ? ` Checked config: ${chainConfigPath}`
      : ` No chain config found for chainId ${effectiveChainId} in ${CHAIN_CONFIG_DIR}.`;
    throw new Error(`Valid vault address required via CLI or GMX_VAULT_ADDRESS.${configHint}`);
  }

  const latestBlock = await provider.getBlockNumber();
  const blockTag = toBlockTag(options.block);
  const blockNumber = blockTag === "latest" ? latestBlock : blockTag;

  applyBundlePaths(options, displayNetworkName, blockNumber);

  const auditBlock = await provider.getBlock(blockNumber);
  if (!auditBlock) {
    throw new Error(`Unable to load block ${blockNumber}`);
  }

  if (options.requireArchive) {
    try {
      await provider.getCode(options.vault, blockNumber);
    } catch (error) {
      if (isArchiveUnavailableError(error)) {
        throw new Error(
          `Archive RPC check failed for block ${blockNumber}. ${getArchiveRecommendationLine()}`
        );
      }
      throw error;
    }
  }

  console.log("========================================");
  console.log(" GMX Vault Auditor");
  console.log("========================================");
  console.log("Network:", displayNetworkName, `(chainId=${Number(network.chainId)})`);
  console.log("RPC:", options.rpc);
  if (options.intakePath) {
    console.log("Intake:", options.intakePath);
    if (options.intakeTargetCount > 1) {
      console.log(`Intake target: ${options.intakeResolvedTargetIndex + 1}/${options.intakeTargetCount}`);
    }
  }
  console.log("Vault:", options.vault);
  console.log("Block:", blockNumber, `(hash=${auditBlock.hash})`);
  if (options.bundleDir) {
    console.log("Bundle:", options.bundleDir);
  }
  console.log("----------------------------------------");

  const producedFiles = [];

  const vault = new ethers.Contract(options.vault, VAULT_ABI, provider);
  const modeProbe = await probeTargetMode(vault, blockNumber);
  let resolvedMode = options.mode;

  if (options.mode === "auto") {
    if (modeProbe.isV1) {
      resolvedMode = "v1";
    } else if (chainConfig && chainConfig.gmxV2 && chainConfig.gmxV2.dataStore && chainConfig.gmxV2.reader) {
      resolvedMode = "v2";
    } else {
      throw new Error(
        `Unknown target type. Probes: ${JSON.stringify(modeProbe.probes)}. If this is GMX v2, add gmxV2.dataStore and gmxV2.reader in chain config.`
      );
    }
  }

  if (options.mode === "v1" && !modeProbe.isV1) {
    throw new Error(`Mode v1 requested but whitelist probes failed: ${JSON.stringify(modeProbe.probes)}`);
  }

  console.log("Mode:", `${options.mode} -> ${resolvedMode}`);
  if (chainConfigPath) {
    console.log("Chain config:", chainConfigPath);
  }

  let tokenAddresses = [];
  let rows = [];
  let v2Context = null;

  if (resolvedMode === "v1") {
    tokenAddresses = await getWhitelistedTokenAddresses(vault, blockNumber);
    console.log("Whitelisted tokens:", tokenAddresses.length);

    rows = await Promise.all(tokenAddresses.map(async (tokenAddress, index) => {
      const { token, symbol, decimals, name, totalSupplyRaw, metadataSource } = await readTokenMetadata(
        tokenAddress,
        provider,
        blockNumber,
        tokenMetadataOverrides
      );

      const [poolAmountRaw] = await Promise.all([
        safeCall(vault, "poolAmounts", [tokenAddress], 0n, blockNumber)
      ]);

      const metadataOk = symbol !== "N/A" && name !== "N/A";
      const tokenType = detectType(symbol, name);

      const vaultBalance = formatUnitsSafe(poolAmountRaw, decimals);
      const totalSupply = formatUnitsSafe(totalSupplyRaw, decimals);

      let priceInfo = {
        priceUsd: null,
        hasPrice: false,
        updatedAt: null,
        stale: null
      };

      if (options.usd) {
        priceInfo = await getPriceInfo(
          provider,
          effectiveChainId,
          tokenAddress,
          blockNumber,
          Number(auditBlock.timestamp),
          options.maxStaleSeconds,
          feedMap
        );
      }

      const balanceFloat = Number(vaultBalance);
      const vaultValueUsd = priceInfo.priceUsd === null ? null : balanceFloat * priceInfo.priceUsd;

      return {
        index,
        address: tokenAddress,
        symbol,
        name,
        decimals: Number(decimals),
        type: tokenType,
        vaultBalance,
        totalSupply,
        priceUsd: priceInfo.priceUsd === null ? "N/A" : priceInfo.priceUsd.toFixed(6),
        vaultValueUsd: vaultValueUsd === null ? "N/A" : vaultValueUsd.toFixed(2),
        priceUpdatedAt: priceInfo.updatedAt || "N/A",
        priceStale: priceInfo.stale === null ? "N/A" : priceInfo.stale,
        metadataOk,
        metadataSource,
        hasPrice: priceInfo.hasPrice && priceInfo.priceUsd !== null
      };
    }));
  } else {
    if (!options.dataStore || !options.reader) {
      throw new Error("Mode v2 requires reader and datastore addresses via config or --reader/--datastore");
    }

    const markets = await getV2Markets(provider, options.dataStore, options.reader, blockNumber);
    if (markets.length === 0) {
      throw new Error("Mode v2 found zero markets from Reader.getMarkets; verify datastore/reader addresses");
    }

    const v2Vaults = resolveV2Vaults(options, chainConfig);
    if (v2Vaults.length === 0) {
      throw new Error("Mode v2 requires at least one vault address via gmxV2.vault/gmxV2.vaults or --v2-vault");
    }
    options.securityTarget = v2Vaults[0];

    tokenAddresses = dedupeAddresses(markets.flatMap((m) => [m.longToken, m.shortToken]));
    console.log("V2 markets:", markets.length);
    console.log("V2 collateral tokens:", tokenAddresses.length);
    console.log("V2 vaults:", v2Vaults.join(", "));

    const v2Analysis = await buildV2MarketContext({
      provider,
      chainId: effectiveChainId,
      blockTag: blockNumber,
      blockTimestamp: Number(auditBlock.timestamp),
      maxStaleSeconds: options.maxStaleSeconds,
      feedMap,
      metadataOverrides: tokenMetadataOverrides,
      includePrices: options.usd,
      markets
    });
    const marketRows = v2Analysis.marketRows.map((row) => ({
      index: row.index,
      marketToken: row.marketToken,
      indexToken: row.indexToken,
      longToken: row.longToken,
      shortToken: row.shortToken,
      hasIndexFeed: row.hasIndexFeed
    }));
    console.table(marketRows.slice(0, Math.min(options.preview, 20)));
    rows = v2Analysis.collateralTokenRows;

    v2Context = {
      reader: options.reader,
      dataStore: options.dataStore,
      vaults: v2Vaults,
      balanceSource: "marketTokenHoldings",
      markets: v2Analysis.marketRows,
      collateralTokens: v2Analysis.collateralTokens,
      marketSummary: v2Analysis.marketSummary
    };
  }

  const exposureBaseTotal = rows.reduce((sum, row) => {
    if (row.vaultValueUsd !== "N/A") {
      return sum + toNumberOrZero(row.vaultValueUsd);
    }
    return sum + toNumberOrZero(row.vaultBalance);
  }, 0);

  const enrichedRows = rows.map((row) => {
    const scored = computeTokenRisk(row, exposureBaseTotal);
    return {
      ...row,
      isStablecoin: scored.isStablecoin,
      hasFeed: scored.hasFeed,
      isLpToken: scored.isLpToken,
      exposurePct: scored.exposurePct.toFixed(2),
      riskScore: scored.riskScore
    };
  });

  console.table(enrichedRows.slice(0, options.preview).map((row) => ({
    index: row.index,
    symbol: row.symbol,
    type: row.type,
    address: row.address,
    vaultBalance: row.vaultBalance,
    usdExposure: row.vaultValueUsd,
    stablecoin: row.isStablecoin ? "✅" : "❌",
    feed: row.hasFeed ? "✅" : "❌",
    lp: row.isLpToken ? "⚠️" : "❌",
    exposurePct: `${row.exposurePct}%`,
    priceUsd: row.priceUsd,
    vaultValueUsd: row.vaultValueUsd,
    priceStale: row.priceStale,
    riskScore: row.riskScore
  })));

  if (enrichedRows.length > options.preview) {
    console.log(`Showing first ${options.preview} of ${enrichedRows.length} tokens`);
  }

  const summary = {
    totalTokens: enrichedRows.length,
    stablecoins: enrichedRows.filter((row) => row.type === "Stablecoin").length,
    lpTokens: enrichedRows.filter((row) => row.type === "LP Token").length,
    wrapped: enrichedRows.filter((row) => row.type === "Wrapped").length,
    standard: enrichedRows.filter((row) => row.type === "Standard").length,
    metadataFailures: enrichedRows.filter((row) => !row.metadataOk).length,
    zeroLiquidity: enrichedRows.filter((row) => Number(row.vaultBalance) === 0).length,
    missingPrice: options.usd ? enrichedRows.filter((row) => !row.hasPrice).length : "N/A",
    stalePriceFeeds: options.usd ? enrichedRows.filter((row) => row.priceStale === true).length : "N/A",
    avgRiskScore: (enrichedRows.reduce((sum, row) => sum + row.riskScore, 0) / Math.max(enrichedRows.length, 1)).toFixed(2),
    highRiskTokens: enrichedRows.filter((row) => row.riskScore >= 6).length
  };

  if (v2Context) {
    summary.v2Markets = v2Context.markets.length;
    summary.v2CollateralTokens = v2Context.collateralTokens.length;
    summary.v2VaultCount = v2Context.vaults.length;
    summary.v2MissingIndexFeeds = v2Context.marketSummary.missingIndexFeeds;
    summary.v2MissingCollateralFeeds = v2Context.marketSummary.missingCollateralFeeds;
    summary.v2StaleIndexFeeds = v2Context.marketSummary.staleIndexFeeds;
    summary.v2ZeroLiquidityMarkets = v2Context.marketSummary.zeroLiquidityMarkets;
    summary.v2HighRiskMarkets = v2Context.marketSummary.highRiskMarkets;
    summary.v2TopMarketToken = v2Context.marketSummary.topMarketToken;
    summary.v2TopMarketSharePct = v2Context.marketSummary.topMarketSharePct;
  }

  if (options.usd) {
    const tvl = enrichedRows.reduce((sum, row) => sum + (row.vaultValueUsd === "N/A" ? 0 : Number(row.vaultValueUsd)), 0);
    summary.tvlUsd = tvl.toFixed(2);

    const stableExposure = enrichedRows
      .filter((row) => row.type === "Stablecoin")
      .reduce((sum, row) => sum + (row.vaultValueUsd === "N/A" ? 0 : Number(row.vaultValueUsd)), 0);
    summary.stablecoinExposureUsd = stableExposure.toFixed(2);

    const sorted = [...enrichedRows].sort((a, b) => {
      const av = a.vaultValueUsd === "N/A" ? 0 : Number(a.vaultValueUsd);
      const bv = b.vaultValueUsd === "N/A" ? 0 : Number(b.vaultValueUsd);
      return bv - av;
    });

    const top = sorted[0];
    const topValue = top && top.vaultValueUsd !== "N/A" ? Number(top.vaultValueUsd) : 0;
    const concentration = tvl > 0 ? (topValue / tvl) * 100 : 0;
    summary.topTokenSymbol = top ? top.symbol : "N/A";
    summary.topTokenWeightPct = concentration.toFixed(2);
  }

  console.log("\n========== AUDIT SUMMARY ==========");
  console.table([summary]);

  if (options.riskSummary) {
    console.log("\n========== RISK SCORE SUMMARY ==========");
    console.table([
      {
        avgRiskScore: summary.avgRiskScore,
        highRiskTokens: summary.highRiskTokens,
        totalTokens: summary.totalTokens,
        highRiskPct: ((Number(summary.highRiskTokens) / Math.max(Number(summary.totalTokens), 1)) * 100).toFixed(2)
      }
    ]);
  }

  if (options.risk) {
    const riskFlags = [];
    if (summary.zeroLiquidity > 0) {
      riskFlags.push(`${summary.zeroLiquidity} zero-liquidity tokens`);
    }
    if (summary.metadataFailures > 0) {
      riskFlags.push(`${summary.metadataFailures} tokens with metadata failures`);
    }
    if (options.usd && Number(summary.topTokenWeightPct) >= 50) {
      riskFlags.push(`high concentration: ${summary.topTokenWeightPct}% in ${summary.topTokenSymbol}`);
    }
    if (options.usd && summary.missingPrice !== "N/A" && summary.missingPrice > 0) {
      riskFlags.push(`${summary.missingPrice} tokens missing price feeds`);
    }
    if (options.usd && summary.stalePriceFeeds !== "N/A" && summary.stalePriceFeeds > 0) {
      riskFlags.push(`${summary.stalePriceFeeds} stale price feeds`);
    }

    console.log("\n========== RISK FLAGS ==========");
    if (riskFlags.length === 0) {
      console.log("No high-signal risk flags from current heuristics");
    } else {
      for (const flag of riskFlags) {
        console.log(`- ${flag}`);
      }
    }
  }

  if (options.csv) {
    const csvOutput = writeCsv(options.csvPath, enrichedRows);
    console.log(`\nCSV exported: ${csvOutput}`);
    producedFiles.push(csvOutput);
  }

  let resolvedJson = null;
  if (options.json) {
    resolvedJson = path.resolve(process.cwd(), options.jsonPath);
    fs.mkdirSync(path.dirname(resolvedJson), { recursive: true });
    fs.writeFileSync(resolvedJson, `${JSON.stringify({
      network: {
        name: displayNetworkName,
        chainId: effectiveChainId
      },
      rpc: options.rpc,
      vault: options.vault,
      modeResolved: resolvedMode,
      v2: v2Context,
      block: {
        number: blockNumber,
        hash: auditBlock.hash,
        timestamp: Number(auditBlock.timestamp)
      },
      summary,
      tokens: enrichedRows,
      markets: v2Context ? v2Context.markets : []
    }, null, 2)}\n`, "utf8");
    console.log(`JSON exported: ${resolvedJson}`);
    producedFiles.push(resolvedJson);
  }

  let security = null;
  let ai = null;
  const gateReasons = [];

  if (options.requireSecurity && !options.security) {
    gateReasons.push("security execution required but --security was not enabled");
  }

  if (options.security) {
    console.log("\n========== SECURITY PIPELINE ==========");
    security = await runSecurityPipeline({
      provider,
      options,
      network,
      blockNumber,
      blockHash: auditBlock.hash,
      blockTimestamp: Number(auditBlock.timestamp)
    });

    console.log(`Security manifest: ${security.manifestPath}`);
    if (Array.isArray(security.outputFiles)) {
      producedFiles.push(...security.outputFiles);
    }

    if (options.recommendArchiveRpc && security.partial) {
      console.warn(`Archive notice: historical security output is partial at block ${blockNumber}.`);
      console.warn(getArchiveRecommendationLine());
    }

    const highCount = Number((security.severityCounts && security.severityCounts.HIGH) || 0);
    const mediumCount = Number((security.severityCounts && security.severityCounts.MEDIUM) || 0);

    if (options.failOnHigh && highCount > 0) {
      gateReasons.push(`security pipeline found ${highCount} high-severity findings`);
    }

    if (Number.isInteger(options.failOnMediumCount) && mediumCount > options.failOnMediumCount) {
      gateReasons.push(
        `security pipeline found ${mediumCount} medium-severity findings (threshold=${options.failOnMediumCount})`
      );
    }

    if (options.failOnSecuritySkip && security.partial) {
      gateReasons.push("security pipeline completed partially (tool missing or errored)");
    }
  }

  if (options.ai) {
    console.log("\n========== AI TRIAGE ==========");
    const { runAIAgent } = require("../auditors/ai-agent");
    ai = await runAIAgent({
      bundlePath: options.bundleDir || path.resolve(process.cwd(), "outputs"),
      aiUrl: options.aiUrl,
      aiModel: options.aiModel,
      context: {
        manifest: {
          chainId: Number(network.chainId),
          network: displayNetworkName,
          block: blockNumber,
          vault: options.vault
        },
        audit: {
          totalTokens: enrichedRows.length,
          topRisky: [...enrichedRows].sort((a, b) => b.riskScore - a.riskScore).slice(0, 10)
        },
        findings: security && security.normalizedPath && fs.existsSync(security.normalizedPath)
          ? JSON.parse(fs.readFileSync(security.normalizedPath, "utf8"))
          : { findings: [] },
        bytecodeHash: security && security.outputFiles && security.outputFiles[0]
          ? sha256File(security.outputFiles[0])
          : null,
        sourceExcerpts: []
      }
    });

    if (Array.isArray(ai.outputFiles)) {
      producedFiles.push(...ai.outputFiles);
    }

    const aiHigh = Array.isArray(ai.ai_findings)
      ? ai.ai_findings.filter((f) => String(f.severity || "").toUpperCase() === "HIGH").length
      : 0;
    const aiSchemaValid = ai && ai.schema_valid === true;
    if (options.failOnAiHigh && aiSchemaValid && aiHigh > 0) {
      gateReasons.push(`AI triage reported ${aiHigh} high-severity findings`);
    }
  }

  const gateResult = applyGate(options.gateMode, gateReasons);
  if (options.printGateJson) {
    const gatePayload = {
      passed: gateResult.passed,
      reasons: gateResult.reasons,
      mode: options.gateMode,
      modeResolved: resolvedMode,
      vault: options.vault,
      block: blockNumber,
      requireSecurity: options.requireSecurity,
      requireBlock: options.requireBlock,
      requireArchive: options.requireArchive,
      failOnHigh: options.failOnHigh,
      failOnMediumCount: Number.isInteger(options.failOnMediumCount) ? options.failOnMediumCount : null,
      failOnSecuritySkip: options.failOnSecuritySkip,
      severityCounts: security && security.severityCounts ? security.severityCounts : {},
      securityPartial: Boolean(security && security.partial),
      recommendArchiveRpc: options.recommendArchiveRpc,
      aiEnabled: options.ai,
      aiModel: options.ai ? options.aiModel : null,
      aiSchemaValid: Boolean(ai && ai.schema_valid),
      aiCacheHit: Boolean(ai && ai.cache_hit),
      aiHighFindings: ai && Array.isArray(ai.ai_findings)
        ? ai.ai_findings.filter((f) => String(f.severity || "").toUpperCase() === "HIGH").length
        : 0,
      v2Markets: v2Context ? v2Context.markets.length : 0,
      v2CollateralTokens: v2Context ? v2Context.collateralTokens.length : 0
    };
    console.log(`GATE_JSON:${JSON.stringify(gatePayload)}`);
  }
  if (!gateResult.passed) {
    throw new Error(`Gate failed: ${gateResult.reasons.join("; ")}`);
  }

  const modeState = {
    modeRequested: options.mode,
    modeResolved: resolvedMode,
    v2Enabled: Boolean(v2Context),
    v2Markets: v2Context ? v2Context.markets.length : 0,
    v2CollateralTokens: v2Context ? v2Context.collateralTokens.length : 0,
    usd: options.usd,
    risk: options.risk,
    riskSummary: options.riskSummary,
    security: options.security,
    csv: options.csv,
    json: options.json,
    reportHtml: Boolean(options.reportHtml),
    reportMd: Boolean(options.reportMd),
    bundle: Boolean(options.bundle),
    ai: options.ai,
    aiModel: options.ai ? options.aiModel : "disabled",
    failOnAiHigh: options.failOnAiHigh,
    aiSchemaValid: Boolean(ai && ai.schema_valid),
    aiCacheHit: Boolean(ai && ai.cache_hit),
    aiGatePassed: options.failOnAiHigh
      ? !(Boolean(ai && ai.schema_valid) && Array.isArray(ai && ai.ai_findings) && ai.ai_findings.some((f) => String(f.severity || "").toUpperCase() === "HIGH"))
      : true,
    failOnHigh: options.failOnHigh,
    failOnMediumCount: Number.isInteger(options.failOnMediumCount) ? options.failOnMediumCount : "disabled",
    failOnSecuritySkip: options.failOnSecuritySkip,
    requireSecurity: options.requireSecurity,
    requireBlock: options.requireBlock,
    requireArchive: options.requireArchive,
    recommendArchiveRpc: options.recommendArchiveRpc,
    gateMode: options.gateMode,
    printGateJson: options.printGateJson
  };

  const evidencePath = path.resolve(process.cwd(), options.evidencePath || "outputs/manifest.json");

  if (options.reportHtml || options.reportMd) {
    const relativeEvidencePath = pathMaybeRelative(evidencePath, options.bundleDir || null);
    const securityLinks = security && options.securityOutputDir ? {
      slither: pathMaybeRelative(path.join(options.securityOutputDir, "slither.json"), options.bundleDir || null),
      mythril: pathMaybeRelative(path.join(options.securityOutputDir, "mythril.json"), options.bundleDir || null),
      normalized: pathMaybeRelative(path.join(options.securityOutputDir, "findings.normalized.json"), options.bundleDir || null)
    } : null;

    const reportOutputs = generateReports(
      {
        vault: options.vault,
        network: {
          name: displayNetworkName,
          chainId: Number(network.chainId)
        },
        block: {
          number: blockNumber,
          hash: auditBlock.hash,
          timestamp: Number(auditBlock.timestamp)
        },
        modes: modeState,
        evidencePath: relativeEvidencePath,
        securityLinks,
        gate: gateResult,
        summary,
        tokens: enrichedRows,
        v2: v2Context,
        security,
        ai
      },
      {
        htmlPath: options.reportHtml,
        markdownPath: options.reportMd
      }
    );

    if (reportOutputs.htmlPath) {
      console.log(`HTML report: ${reportOutputs.htmlPath}`);
      producedFiles.push(reportOutputs.htmlPath);
    }
    if (reportOutputs.markdownPath) {
      console.log(`Markdown report: ${reportOutputs.markdownPath}`);
      producedFiles.push(reportOutputs.markdownPath);
    }
  }

  if (options.bundleDir) {
    const bundleReadme = writeBundleReadme({
      bundleDir: options.bundleDir,
      client: options.client,
      engagement: options.engagement,
      network: {
        name: displayNetworkName,
        chainId: effectiveChainId
      },
      vault: options.vault,
      block: {
        number: blockNumber,
        hash: auditBlock.hash
      },
      modeResolved: resolvedMode,
      v2: v2Context ? {
        reader: v2Context.reader,
        dataStore: v2Context.dataStore,
        marketCount: v2Context.markets.length,
        collateralCount: v2Context.collateralTokens.length
      } : null,
      archive: {
        partialSecurity: Boolean(security && security.partial)
      },
      archiveHint: chainConfig && chainConfig.archiveRpcHint ? String(chainConfig.archiveRpcHint) : null
    });
    producedFiles.push(bundleReadme);
  }

  let redactionResult = null;
  if (options.redact && options.bundleDir) {
    redactionResult = redactBundleFiles(options.bundleDir);
    console.log(`Redaction applied: ${redactionResult.touchedCount} files updated`);
  }

  const manifestPath = writeEvidenceManifest({
    manifestPath: evidencePath,
    vault: options.vault,
    rpc: options.rpc,
    network: {
      name: displayNetworkName,
      chainId: effectiveChainId
    },
    block: {
      requested: String(options.block),
      resolved: blockNumber,
      hash: auditBlock.hash,
      timestamp: Number(auditBlock.timestamp)
    },
    modes: modeState,
    gate: gateResult,
    security,
    ai,
    files: producedFiles,
    bundleRoot: options.bundleDir || null,
    command: redactSensitiveText(process.argv.join(" ")),
    redaction: redactionResult
      ? {
        enabled: true,
        touchedCount: redactionResult.touchedCount
      }
      : {
        enabled: false,
        touchedCount: 0
      },
    scriptFile: path.resolve(process.cwd(), "scripts/gmxVaultAudit.js"),
    feedConfigSha256: hashObject(ADDRESS_PRICE_FEEDS)
  });
  console.log(`Evidence manifest: ${manifestPath}`);

  if (options.zip && options.bundleDir) {
    const defaultZipPath = `${options.bundleDir}.zip`;
    const zipPath = options.zipPath
      ? path.resolve(process.cwd(), options.zipPath)
      : defaultZipPath;
    const zipped = await zipDirectory(options.bundleDir, zipPath);
    console.log(`Bundle zip: ${zipped}`);
  }

  console.log("\nAudit completed successfully");
}

main().catch((error) => {
  console.error("Audit failed:", error.message || error);
  process.exit(1);
});
