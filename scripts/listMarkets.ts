import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

function readDeploymentAddress(fileName: string): string | undefined {
  const filePath = path.join(process.cwd(), "gmx-synthetics", "deployments", "arbitrum", fileName);
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (typeof payload.address === "string" && payload.address.length > 0) {
      return payload.address;
    }
  } catch {
    // Ignore missing deployment artifacts and fallback to env.
  }
  return undefined;
}

async function main(): Promise<void> {
  const rpcUrl = process.env.ARBITRUM_RPC || process.env.ARBITRUM_RPC_URL;
  const readerAddress = process.env.GMX_READER_ADDRESS || readDeploymentAddress("Reader.json");
  const dataStoreAddress = process.env.GMX_DATA_STORE_ADDRESS || readDeploymentAddress("DataStore.json");

  if (!rpcUrl) {
    throw new Error("ARBITRUM_RPC or ARBITRUM_RPC_URL is required");
  }
  if (!readerAddress || !dataStoreAddress) {
    throw new Error("Reader/DataStore address missing. Set GMX_READER_ADDRESS and GMX_DATA_STORE_ADDRESS in .env");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const reader = new ethers.Contract(
    readerAddress,
    [
      "function getMarkets(address dataStore, uint256 start, uint256 end) view returns ((address marketToken,address indexToken,address longToken,address shortToken)[])"
    ],
    provider
  );

  const markets = (await (reader as any).getMarkets(dataStoreAddress, 0, 50)) as Array<{
    marketToken: string;
    indexToken: string;
    longToken: string;
    shortToken: string;
  }>;

  console.log(`Reader: ${readerAddress}`);
  console.log(`DataStore: ${dataStoreAddress}`);
  console.log(`Markets returned: ${markets.length}`);

  for (const [index, market] of markets.entries()) {
    console.log(
      `[${index}] market=${market.marketToken} index=${market.indexToken} long=${market.longToken} short=${market.shortToken}`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
