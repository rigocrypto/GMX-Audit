import fs from "fs";
import path from "path";

import { ethers } from "hardhat";
import { ethers as rawEthers } from "ethers";

import { createContext, runAction } from "../test/gmx-invariants/harness";

function readDeploymentAddress(fileName: string): string {
  const filePath = path.join(process.cwd(), "gmx-synthetics", "deployments", "arbitrum", fileName);
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return payload.address;
}

async function main() {
  const roleStoreAddress = readDeploymentAddress("RoleStore.json");
  const dataStoreAddress = readDeploymentAddress("DataStore.json");

  const rpc = process.env.ARBITRUM_RPC_URL || process.env.ARBITRUM_RPC;
  if (!rpc) {
    throw new Error("Missing ARBITRUM_RPC_URL or ARBITRUM_RPC");
  }

  const rawProvider = new rawEthers.JsonRpcProvider(rpc, 42161);

  const roleStore = new rawEthers.Contract(
    roleStoreAddress,
    [
      "function getRoleMemberCount(bytes32 roleKey) view returns (uint256)",
      "function getRoleMembers(bytes32 roleKey,uint256 start,uint256 end) view returns (address[])"
    ],
    rawProvider
  );

  const dataStore = await ethers.getContractAt(
    [
      "function getBytes32Count(bytes32 key) view returns (uint256)",
      "function getBytes32ValuesAt(bytes32 key,uint256 start,uint256 end) view returns (bytes32[])"
    ],
    dataStoreAddress
  );

  const orderKeeperRole = rawEthers.keccak256(
    rawEthers.AbiCoder.defaultAbiCoder().encode(["string"], ["ORDER_KEEPER"])
  );
  const orderListKey = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["ORDER_LIST"]));

  const keeperCount = await roleStore.getRoleMemberCount(orderKeeperRole, { blockTag: Number(process.env.FORK_BLOCK) });
  const keepers: string[] = await roleStore.getRoleMembers(orderKeeperRole, 0, keeperCount, {
    blockTag: Number(process.env.FORK_BLOCK),
  });

  const ctx = await createContext();
  const user = ctx.users[0];

  await runAction(ctx, { type: "deposit", amountUsd: 1_000n, user });
  await runAction(ctx, { type: "openLong", collateralUsd: 500n, leverageBps: 20_000, user });

  const orderCountAfter = await (dataStore as any).getBytes32Count(orderListKey);
  const latestOrder = await (dataStore as any).getBytes32ValuesAt(orderListKey, orderCountAfter - 1n, orderCountAfter);

  console.log("ORDER_KEEPER count:", keeperCount.toString());
  console.log("ORDER_KEEPER addresses:", keepers);
  console.log("ORDER_LIST count after:", orderCountAfter.toString());
  console.log("Latest order key:", latestOrder[0]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});