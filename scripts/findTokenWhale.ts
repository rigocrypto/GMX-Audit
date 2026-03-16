import "dotenv/config";
import { ethers } from "ethers";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

const WBTC = "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f";

type CandidateMap = Record<string, string[]>;

function asAddress(input: string): string {
  return input.trim().toLowerCase();
}

const CANDIDATES: CandidateMap = {
  [WBTC]: [
    "0x794a61358d6845594f94dc1db02a252b5b4814ad", // Aave v3 Pool
    "0xf977814e90da44bfa03b6295a0616a897441acec", // Binance hot wallet
    "0x47c031236e19d024b42f8ae6780e44a573170703", // GMX BTC/USDC market
    "0x0c4e186eae8b2aa35c7b61c4d32be234a59e2c2", // Candidate GMX vault
    "0x489ee077994b6658eafa855c308275ead8097c4f", // GMX v1 vault candidate
    "0x1add8b0f3c4c8f5797f6154b77c6db3f66c600f", // Camelot pool candidate
    "0xba12222222228d8ba445958a75a0704d566bf2c8" // Balancer vault
  ]
};

async function main(): Promise<void> {
  const rpcUrl = process.env.ARBITRUM_RPC || process.env.ARBITRUM_RPC_URL;
  if (!rpcUrl) {
    throw new Error("Missing ARBITRUM_RPC or ARBITRUM_RPC_URL");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const token = asAddress(process.argv[2] || "");
  if (!token) {
    throw new Error("Usage: npx ts-node scripts/findTokenWhale.ts <tokenAddress>");
  }

  const blockTag = process.env.FORK_BLOCK ? Number(process.env.FORK_BLOCK) : undefined;
  const erc20 = new ethers.Contract(token, ERC20_ABI, provider);

  const [symbol, decimals] = await Promise.all([
    erc20.symbol().catch(() => "UNK"),
    erc20.decimals().catch(() => 18)
  ]);

  const candidates = CANDIDATES[token] || [];
  if (candidates.length === 0) {
    throw new Error(`No candidate list configured for token ${token}`);
  }

  let bestAddress = "";
  let bestBalance = 0n;

  console.log(`token=${token} symbol=${symbol} decimals=${decimals}`);
  console.log(`blockTag=${blockTag ?? "latest"}`);

  for (const candidate of candidates) {
    const address = asAddress(candidate);
    let balance: bigint;
    try {
      balance = blockTag !== undefined ? await erc20.balanceOf(address, { blockTag }) : await erc20.balanceOf(address);
    } catch {
      balance = 0n;
    }

    if (balance > bestBalance) {
      bestBalance = balance;
      bestAddress = address;
    }

    console.log(`${address} ${balance.toString()}`);
  }

  console.log(`BEST ${bestAddress} ${bestBalance.toString()} decimals=${decimals}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
