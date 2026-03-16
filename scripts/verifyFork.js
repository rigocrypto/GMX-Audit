const fs = require("fs");
const hre = require("hardhat");

async function main() {
  const block = await hre.ethers.provider.getBlockNumber();
  console.log("Fork block:", block);

  const exchAddr = "0x1C3fa76e6E1088bCE750f23a5BFcffa1efEF6A41";
  const code = await hre.ethers.provider.getCode(exchAddr);
  console.log("ExchangeRouter code length:", code.length);

  const readerJson = JSON.parse(fs.readFileSync("gmx-synthetics/deployments/arbitrum/Reader.json", "utf8"));
  const dsJson = JSON.parse(fs.readFileSync("gmx-synthetics/deployments/arbitrum/DataStore.json", "utf8"));
  const reader = new hre.ethers.Contract(readerJson.address, readerJson.abi, hre.ethers.provider);
  const markets = await reader.getMarkets(dsJson.address, 0, 5);
  console.log("Markets count:", markets.length);
  if (markets.length > 0) {
    console.log("Market[0] token:", markets[0].marketToken);
  }
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
