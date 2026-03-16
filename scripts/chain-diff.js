const fs = require("fs");
const path = require("path");
const { JsonRpcProvider, keccak256 } = require("ethers");

const root = process.cwd();
const deploymentsRoot = path.join(root, "gmx-synthetics", "deployments");
const outputFile = path.join(root, "outputs", "chain_diff.md");

function stripMetadata(bytecode) {
  // Solidity appends CBOR-encoded metadata to bytecode (compiler version, IPFS hash, etc.)
  // Last 2 bytes are little-endian length of the metadata block.
  // Stripping metadata avoids false positives from different compiler versions producing identical logic.
  if (!bytecode || bytecode === "0x" || bytecode.length < 8) {
    return bytecode;
  }

  try {
    // Read metadata length from last 2 bytes (little-endian, as hex)
    const metaLenHex = bytecode.slice(-4); // Last 4 hex chars = last 2 bytes
    const metaLen = parseInt(metaLenHex, 16);

    // Sanity check: metadata block should be reasonable size
    if (metaLen > 0 && metaLen < 500) {
      // Strip the metadata block + the 2-byte length field
      const stripOffset = bytecode.length - 4 - metaLen * 2;
      if (stripOffset > 0) {
        return bytecode.slice(0, stripOffset);
      }
    }
  } catch (e) {
    // If parsing fails, return original bytecode
  }
  return bytecode;
}

function normalizeBytecode(code) {
  if (!code || code === "0x") {
    return "0x";
  }
  // First strip Solidity metadata to avoid noise from different compiler versions
  const stripped = stripMetadata(code);
  // Then zero out PUSH20 + address patterns to avoid false drift from linked libs
  return stripped.replace(/73[0-9a-fA-F]{40}/g, `73${"00".repeat(20)}`);
}

function loadDeploymentMap(chainName) {
  const chainDir = path.join(deploymentsRoot, chainName);
  const files = fs.readdirSync(chainDir).filter((name) => name.endsWith(".json") && !name.startsWith("."));
  const map = new Map();

  for (const fileName of files) {
    const filePath = path.join(chainDir, fileName);
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (payload && typeof payload.address === "string" && payload.address) {
        map.set(fileName.replace(/\.json$/i, ""), payload.address);
      }
    } catch {
      // Ignore malformed entries.
    }
  }

  return map;
}

async function getCodeInfo(provider, address) {
  const code = await provider.getCode(address);
  const normalizedCode = normalizeBytecode(code);
  return {
    rawCode: code,
    normalizedCode,
    sizeBytes: code === "0x" ? 0 : (code.length - 2) / 2,
    rawHash: code === "0x" ? "0x0" : keccak256(code),
    normalizedHash: normalizedCode === "0x" ? "0x0" : keccak256(normalizedCode),
  };
}

async function main() {
  const arbRpc = process.env.ARBITRUM_RPC_URL || process.env.ARBITRUM_RPC;
  const avaRpc = process.env.AVALANCHE_RPC_URL || process.env.AVALANCHE_RPC;

  if (!arbRpc || !avaRpc) {
    throw new Error("ARBITRUM_RPC_URL/ARBITRUM_RPC and AVALANCHE_RPC_URL/AVALANCHE_RPC are required");
  }

  const arbMap = loadDeploymentMap("arbitrum");
  const avaMap = loadDeploymentMap("avalanche");
  const commonNames = [...arbMap.keys()].filter((name) => avaMap.has(name)).sort((a, b) => a.localeCompare(b));

  const arbProvider = new JsonRpcProvider(arbRpc);
  const avaProvider = new JsonRpcProvider(avaRpc);

  const rows = [];
  for (const name of commonNames) {
    const arbAddr = arbMap.get(name);
    const avaAddr = avaMap.get(name);

    try {
      const [arbInfo, avaInfo] = await Promise.all([
        getCodeInfo(arbProvider, arbAddr),
        getCodeInfo(avaProvider, avaAddr),
      ]);

      rows.push({
        contract: name,
        arbitrum: arbAddr,
        avalanche: avaAddr,
        rawMatch: arbInfo.rawHash === avaInfo.rawHash,
        normalizedMatch: arbInfo.normalizedHash === avaInfo.normalizedHash,
        arbSize: arbInfo.sizeBytes,
        avaSize: avaInfo.sizeBytes,
        arbHash: arbInfo.rawHash,
        avaHash: avaInfo.rawHash,
        arbNormalizedHash: arbInfo.normalizedHash,
        avaNormalizedHash: avaInfo.normalizedHash,
        error: "",
      });
    } catch (error) {
      rows.push({
        contract: name,
        arbitrum: arbAddr,
        avalanche: avaAddr,
        rawMatch: false,
        normalizedMatch: false,
        arbSize: 0,
        avaSize: 0,
        arbHash: "n/a",
        avaHash: "n/a",
        arbNormalizedHash: "n/a",
        avaNormalizedHash: "n/a",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await arbProvider.destroy();
  await avaProvider.destroy();

  const rawMismatches = rows.filter((row) => !row.rawMatch);
  const normalizedMismatches = rows.filter((row) => !row.normalizedMatch);
  const lines = [
    "# Chain Diff (Arbitrum vs Avalanche)",
    "",
    "Comparison mode:",
    "- Raw bytecode hash (can differ due to linked-library addresses)",
    "- Normalized bytecode hash (PUSH20 embedded addresses zeroed)",
    "",
    `Compared contracts: ${rows.length}`,
    `Raw mismatches: ${rawMismatches.length}`,
    `Normalized mismatches: ${normalizedMismatches.length}`,
    "",
    "| Contract | Raw Match | Normalized Match | Arb Size | Ava Size | Notes |",
    "|---|---|---|---:|---:|---|",
  ];

  for (const row of rows) {
    const notes = row.error
      ? `error: ${row.error.replace(/\|/g, "\\|").slice(0, 120)}`
      : row.normalizedMatch
        ? "normalized logic hash equal"
        : "normalized logic hash differs";
    lines.push(
      `| ${row.contract} | ${row.rawMatch ? "yes" : "no"} | ${row.normalizedMatch ? "yes" : "no"} | ${row.arbSize} | ${row.avaSize} | ${notes} |`
    );
  }

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${lines.join("\n")}\n`);

  console.log(`chain_diff_compared=${rows.length}`);
  console.log(`chain_diff_raw_mismatches=${rawMismatches.length}`);
  console.log(`chain_diff_normalized_mismatches=${normalizedMismatches.length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
