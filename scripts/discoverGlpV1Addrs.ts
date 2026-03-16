import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const ROUTER_CANDIDATES = [
  "0xA906F338CB21815cBc4Bc87ace9e68c87eF8d8F1"
];

const REWARD_ROUTER_ABI = [
  "function glpManager() view returns (address)",
  "function stakedGlpTracker() view returns (address)",
  "function feeGlpTracker() view returns (address)",
  "function glp() view returns (address)"
];

async function getCodeAt(provider: ethers.JsonRpcProvider, address: string, blockTag?: number): Promise<string> {
  if (blockTag && blockTag > 0) {
    return provider.getCode(address, blockTag);
  }
  return provider.getCode(address);
}

async function main(): Promise<void> {
  const rpc = process.env.ARBITRUM_RPC_URL || process.env.ARBITRUM_RPC;
  if (!rpc) {
    throw new Error("Set ARBITRUM_RPC_URL or ARBITRUM_RPC before running discovery.");
  }

  const forkBlockRaw = process.env.FORK_BLOCK || process.env.ARBITRUM_FORK_BLOCK;
  const blockTag = forkBlockRaw ? Number(forkBlockRaw) : undefined;
  if (forkBlockRaw && (!blockTag || Number.isNaN(blockTag))) {
    throw new Error(`Invalid fork block value: ${forkBlockRaw}`);
  }

  const envRouter = process.env.GMX_GLP_REWARD_ROUTER;
  const extraCandidates = (process.env.GMX_GLP_ROUTER_CANDIDATES || "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

  const routerCandidates = [
    ...(envRouter ? [envRouter] : []),
    ...ROUTER_CANDIDATES,
    ...extraCandidates
  ].filter((value, index, arr) => arr.indexOf(value) === index);
  const provider = new ethers.JsonRpcProvider(rpc);

  console.log(`[glp-discovery] rpc=${rpc}`);
  if (blockTag) {
    console.log(`[glp-discovery] blockTag=${blockTag}`);
  }

  for (const routerAddr of routerCandidates) {
    if (!ethers.isAddress(routerAddr)) {
      console.log(`[glp-discovery] router=${routerAddr} invalid address literal`);
      continue;
    }

    const code = await getCodeAt(provider, routerAddr, blockTag);
    if (code === "0x") {
      console.log(`[glp-discovery] router=${routerAddr} no code`);
      continue;
    }

    const router = new ethers.Contract(routerAddr, REWARD_ROUTER_ABI, provider);

    try {
      const [manager, stakedGlpTracker, feeGlpTracker, glp] = await Promise.all([
        router.glpManager({ blockTag }),
        router.stakedGlpTracker({ blockTag }),
        router.feeGlpTracker({ blockTag }),
        router.glp({ blockTag })
      ]);

      const managerCode = await getCodeAt(provider, manager, blockTag);
      const glpCode = await getCodeAt(provider, glp, blockTag);

      console.log(`[glp-discovery] router=${routerAddr}`);
      console.log(`  glpManager=${manager} code=${managerCode === "0x" ? "missing" : "present"}`);
      console.log(`  stakedGlpTracker=${stakedGlpTracker}`);
      console.log(`  feeGlpTracker=${feeGlpTracker}`);
      console.log(`  glp=${glp} code=${glpCode === "0x" ? "missing" : "present"}`);
      console.log(`  export: GMX_GLP_REWARD_ROUTER=${routerAddr}`);
      console.log(`  export: GMX_GLP_MANAGER=${manager}`);
      console.log(`  export: GMX_GLP_STAKED_GLP=${stakedGlpTracker}`);
    } catch (error) {
      const message = String((error as Error)?.message || error);
      console.log(`[glp-discovery] router=${routerAddr} query failed: ${message.slice(0, 220)}`);
    }
  }
}

main().catch((error) => {
  console.error(`[glp-discovery] failed: ${String((error as Error)?.message || error)}`);
  process.exit(1);
});
