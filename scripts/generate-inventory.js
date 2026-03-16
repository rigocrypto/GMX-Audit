const fs = require("fs");
const path = require("path");

const root = process.cwd();
const deploymentsRoot = path.join(root, "gmx-synthetics", "deployments");
const outputFile = path.join(root, "outputs", "inventory.json");

function classifyType(name) {
  const lower = name.toLowerCase();
  if (lower.includes("glv")) return "V2_GLV";
  if (lower.includes("oracle") || lower.includes("chainlink")) return "V2_ORACLE";
  if (lower.includes("exchangerouter")) return "V2_ENTRY";
  if (lower.includes("datastore") || lower.includes("rolestore") || lower.includes("config")) return "V2_CONFIG";
  if (lower.includes("vault") || lower.includes("router")) return "V1_OR_V2_ROUTING";
  return "V2_MISC";
}

function classifyPriority(name) {
  const lower = name.toLowerCase();
  if (lower.includes("glv") || lower.includes("oracle") || lower.includes("exchangerouter")) return "CRITICAL";
  if (lower.includes("datastore") || lower.includes("rolestore") || lower.includes("config") || lower.includes("liquidation")) return "HIGH";
  return "MEDIUM";
}

function loadChain(chainName) {
  const chainDir = path.join(deploymentsRoot, chainName);
  const files = fs.readdirSync(chainDir).filter((name) => name.endsWith(".json") && !name.startsWith("."));

  return files
    .map((fileName) => {
      const filePath = path.join(chainDir, fileName);
      try {
        const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (!payload || typeof payload.address !== "string" || payload.address.length === 0) {
          return null;
        }
        const contractName = fileName.replace(/\.json$/i, "");
        return {
          name: contractName,
          chain: chainName,
          address: payload.address,
          type: classifyType(contractName),
          priority: classifyPriority(contractName),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function main() {
  const chains = ["arbitrum", "avalanche"];
  const inventory = chains.flatMap(loadChain).sort((a, b) => {
    if (a.chain === b.chain) return a.name.localeCompare(b.name);
    return a.chain.localeCompare(b.chain);
  });

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(inventory, null, 2));

  console.log(`inventory_count=${inventory.length}`);
  const byChain = inventory.reduce((acc, item) => {
    acc[item.chain] = (acc[item.chain] || 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify(byChain));
}

main();
