import { ethers } from "hardhat";

const REQUIRED_ENV: Record<string, string> = {
  GMX_EXCHANGE_ROUTER_ADDRESS: "ExchangeRouter",
  GMX_MARKET_ADDRESS: "Market token",
  GMX_WHALE_ADDRESS: "Whale address",
  GMX_COLLATERAL_TOKEN: "Collateral token",
  GMX_EXECUTION_FEE_WEI: "Execution fee (wei)"
};

async function main() {
  let failed = 0;

  const rpcUrl = process.env.ARBITRUM_RPC_URL || process.env.ARBITRUM_RPC;
  if (!rpcUrl || String(rpcUrl).trim().length === 0) {
    console.error("MISSING: ARBITRUM_RPC_URL or ARBITRUM_RPC (RPC endpoint)");
    failed += 1;
  }

  for (const [key, label] of Object.entries(REQUIRED_ENV)) {
    if (!process.env[key] || String(process.env[key]).trim().length === 0) {
      console.error(`MISSING: ${key} (${label})`);
      failed += 1;
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} required environment value(s) missing.`);
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const addressEnvs = [
    "GMX_EXCHANGE_ROUTER_ADDRESS",
    "GMX_MARKET_ADDRESS",
    "GMX_COLLATERAL_TOKEN"
  ] as const;

  for (const envKey of addressEnvs) {
    const addr = process.env[envKey] as string;
    if (!ethers.isAddress(addr)) {
      console.error(`INVALID ADDRESS: ${envKey}=${addr}`);
      failed += 1;
      continue;
    }

    const code = await provider.getCode(addr);
    if (code === "0x") {
      console.error(`NO CODE AT: ${envKey}=${addr} (wrong address or wrong fork block)`);
      failed += 1;
    } else {
      console.log(`OK: ${envKey}=${addr} (code bytes: ${(code.length - 2) / 2})`);
    }
  }

  const whale = process.env.GMX_WHALE_ADDRESS as string;
  if (!ethers.isAddress(whale)) {
    console.error(`INVALID ADDRESS: GMX_WHALE_ADDRESS=${whale}`);
    failed += 1;
  } else {
    const collateral = process.env.GMX_COLLATERAL_TOKEN as string;
    const token = new ethers.Contract(
      collateral,
      [
        "function balanceOf(address) view returns (uint256)",
        "function symbol() view returns (string)",
        "function decimals() view returns (uint8)"
      ],
      provider
    );

    const [balance, symbol, decimals] = await Promise.all([
      token.balanceOf(whale),
      token.symbol().catch(() => "TOKEN"),
      token.decimals().catch(() => 18)
    ]);

    const minWhaleBalance = decimals >= 6 ? ethers.parseUnits("10000", Number(decimals)) : 0n;
    if (balance < minWhaleBalance) {
      console.error(
        `LOW WHALE BALANCE: ${whale} holds ${ethers.formatUnits(balance, Number(decimals))} ${symbol} (need >= ${ethers.formatUnits(minWhaleBalance, Number(decimals))})`
      );
      failed += 1;
    } else {
      console.log(`OK: Whale ${whale} holds ${ethers.formatUnits(balance, Number(decimals))} ${symbol}`);
    }
  }

  const feeWei = process.env.GMX_EXECUTION_FEE_WEI as string;
  if (!/^\d+$/.test(feeWei)) {
    console.error(`INVALID GMX_EXECUTION_FEE_WEI: ${feeWei}`);
    failed += 1;
  }

  if (failed > 0) {
    console.error(`\n${failed} validation(s) failed. Fix before running real mutations.`);
    process.exit(1);
  }

  console.log("\nAll validations passed. Safe to enable GMX_ENABLE_REAL_MUTATIONS=1");
}

main().catch((error: Error) => {
  console.error(error.message || error);
  process.exit(1);
});
