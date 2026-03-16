import { ethers } from "hardhat";
import { createContext, MARKET_SETS, type GMXInvariantContext } from "../test/gmx-invariants/harness";

async function main(): Promise<void> {
  const marketSet = MARKET_SETS[0];
  const [signer] = await ethers.getSigners();
  const signerAddress = await signer.getAddress();

  const ctx = (await createContext({
    adapterMode: "real",
    marketSet,
    userAddresses: [signerAddress]
  })) as GMXInvariantContext;

  const adapter: any = ctx.adapter as any;
  const amount = ethers.parseEther("10");

  await adapter.fundSignerFromWhale(ctx, signerAddress, marketSet.collateralToken, amount);

  const token = await ethers.getContractAt(
    ["function balanceOf(address) view returns (uint256)", "function symbol() view returns (string)"],
    marketSet.collateralToken
  );
  const bal = await (token as any).balanceOf(signerAddress);
  const symbol = await (token as any).symbol();
  console.log(`[test-funding] ${symbol} balance: ${bal.toString()}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
