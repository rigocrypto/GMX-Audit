// scripts/gmxVault.js
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

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

function parseScriptOptions(argv) {
  const args = argv.slice(2);
  let vaultAddress = normalizeAddress(process.env.GMX_VAULT_ADDRESS || "");
  let csvPath = process.env.GMX_VAULT_CSV_PATH;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    const normalizedAddress = normalizeAddress(arg);
    if (!vaultAddress && normalizedAddress) {
      vaultAddress = normalizedAddress;
      continue;
    }

    if (arg === "--csv") {
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("--")) {
        csvPath = nextArg;
        i++;
      } else if (!csvPath) {
        csvPath = "whitelisted-tokens.csv";
      }
      continue;
    }

    if (arg.startsWith("--csv=")) {
      const value = arg.slice("--csv=".length).trim();
      csvPath = value || "whitelisted-tokens.csv";
    }
  }

  return { vaultAddress, csvPath };
}

function csvEscape(value) {
  const text = String(value);
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/\"/g, '""')}"`;
  }
  return text;
}

function writeCsv(filePath, rows) {
  const lines = ["index,token,symbol,decimals"];
  for (const row of rows) {
    lines.push(
      `${csvEscape(row.index)},${csvEscape(row.token)},${csvEscape(row.symbol)},${csvEscape(row.decimals)}`
    );
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  fs.writeFileSync(resolvedPath, `${lines.join("\n")}\n`, "utf8");
  return resolvedPath;
}

async function getTokenMetadata(tokenAddress) {
  const tokenAbi = [
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)"
  ];

  const token = new ethers.Contract(tokenAddress, tokenAbi, ethers.provider);

  let symbol = "N/A";
  let decimals = "N/A";

  try {
    symbol = await token.symbol();
  } catch (_) {
    symbol = "N/A";
  }

  try {
    decimals = Number(await token.decimals());
  } catch (_) {
    decimals = "N/A";
  }

  return { symbol, decimals };
}

async function main() {
  const { vaultAddress, csvPath } = parseScriptOptions(process.argv);
  if (!vaultAddress) {
    throw new Error(
      "Set a valid GMX vault address via GMX_VAULT_ADDRESS or pass it as the first script arg"
    );
  }

  // ABI fragment for whitelisted token access
  const abi = [
    "function whitelistedTokens(uint256) view returns (address)",
    "function whitelistedTokenCount() view returns (uint256)"
  ];

  // Read-only contract instance connected to the current provider
  const contract = new ethers.Contract(vaultAddress, abi, ethers.provider);

  // Get number of whitelisted tokens
  const count = await contract.whitelistedTokenCount();
  console.log("Total whitelisted tokens:", count.toString());

  // Print first 25 token addresses (or all if fewer) as a table for quick audits.
  const total = Number(count);
  const limit = Math.min(total, 25);
  if (total > limit) {
    console.log(`Showing first ${limit} of ${total} whitelisted tokens:`);
  } else {
    console.log(`Showing all ${limit} whitelisted tokens:`);
  }

  const rows = [];
  for (let i = 0; i < limit; i++) {
    const tokenAddress = await contract.whitelistedTokens(i);
    const metadata = await getTokenMetadata(tokenAddress);
    rows.push({ index: i, token: tokenAddress, symbol: metadata.symbol, decimals: metadata.decimals });
  }

  console.table(rows);

  if (csvPath) {
    const csvRows = [];
    for (let i = 0; i < total; i++) {
      const tokenAddress = await contract.whitelistedTokens(i);
      const metadata = await getTokenMetadata(tokenAddress);
      csvRows.push({ index: i, token: tokenAddress, symbol: metadata.symbol, decimals: metadata.decimals });
    }

    const savedPath = writeCsv(csvPath, csvRows);
    console.log(`CSV exported: ${savedPath}`);
  }
}

// Handle errors
main().catch((err) => {
  console.error("Error in script:", err);
  process.exit(1);
});