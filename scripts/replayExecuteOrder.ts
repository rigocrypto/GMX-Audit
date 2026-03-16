import "dotenv/config";

import fs from "fs";
import path from "path";

import { ethers, network } from "hardhat";
import { ethers as rawEthers } from "ethers";

import { createContext, runAction } from "../test/gmx-invariants/harness";

function deploymentAddress(fileName: string): string {
  const filePath = path.join(process.cwd(), "gmx-synthetics", "deployments", "arbitrum", fileName);
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!payload.address || typeof payload.address !== "string") {
    throw new Error(`Missing address in deployment file: ${fileName}`);
  }
  return payload.address;
}

function deploymentArtifact(fileName: string): { address: string; abi: any[] } {
  const filePath = path.join(process.cwd(), "gmx-synthetics", "deployments", "arbitrum", fileName);
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!payload.address || !Array.isArray(payload.abi)) {
    throw new Error(`Invalid deployment artifact: ${fileName}`);
  }
  return payload;
}

function toPlainValue(value: any): any {
  if (typeof value === "bigint" || typeof value === "string" || typeof value === "boolean" || value == null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toPlainValue(item));
  }

  if (typeof value === "object") {
    const plainObject: Record<string, any> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      if (!Number.isNaN(Number(key))) {
        continue;
      }
      plainObject[key] = toPlainValue(nestedValue);
    }
    return plainObject;
  }

  return value;
}

async function resolveKeeperAddress(
  rpc: string,
  roleStoreAddress: string,
  blockTag: number,
  fallback?: string
): Promise<string> {
  if (fallback) {
    return fallback;
  }

  const provider = new rawEthers.JsonRpcProvider(rpc, 42161);
  const roleStore = new rawEthers.Contract(
    roleStoreAddress,
    ["function getRoleMembers(bytes32 roleKey,uint256 start,uint256 end) view returns (address[])"]
  ).connect(provider);

  const orderKeeperRole = rawEthers.keccak256(
    rawEthers.AbiCoder.defaultAbiCoder().encode(["string"], ["ORDER_KEEPER"])
  );

  const keepers: string[] = await roleStore.getRoleMembers(orderKeeperRole, 0, 1, { blockTag });
  if (!keepers.length) {
    throw new Error("No ORDER_KEEPER found at the selected block. Set GMX_KEEPER_ADDRESS explicitly.");
  }

  return keepers[0];
}

async function main() {
  const rpc = process.env.ARBITRUM_RPC_URL || process.env.ARBITRUM_RPC;
  if (!rpc) {
    throw new Error("Missing ARBITRUM_RPC_URL or ARBITRUM_RPC");
  }

  if (process.env.GMX_ENABLE_REAL_MUTATIONS !== "1") {
    throw new Error("Set GMX_ENABLE_REAL_MUTATIONS=1 before running replayExecuteOrder.ts");
  }

  const executeTxHash = process.env.GMX_EXECUTEORDER_TXHASH;
  if (!executeTxHash) {
    throw new Error("Set GMX_EXECUTEORDER_TXHASH to a real executeOrder transaction hash");
  }

  const orderHandlerArtifact = deploymentArtifact("OrderHandler.json");
  const orderHandlerAddress = orderHandlerArtifact.address;
  const roleStoreAddress = deploymentAddress("RoleStore.json");
  const dataStoreAddress = deploymentAddress("DataStore.json");
  const eventEmitterArtifact = deploymentArtifact("EventEmitter.json");

  const rawProvider = new rawEthers.JsonRpcProvider(rpc, 42161);
  const sourceTx = await rawProvider.getTransaction(executeTxHash);
  if (!sourceTx) {
    throw new Error(`Transaction not found: ${executeTxHash}`);
  }

  const sourceReceipt = await rawProvider.getTransactionReceipt(executeTxHash);
  if (!sourceReceipt) {
    throw new Error(`Transaction receipt not found: ${executeTxHash}`);
  }
  const sourceBlock = await rawProvider.getBlock(sourceReceipt.blockNumber);
  if (!sourceBlock) {
    throw new Error(`Source block not found: ${sourceReceipt.blockNumber}`);
  }

  const forkBlock = process.env.FORK_BLOCK ? Number(process.env.FORK_BLOCK) : Number(sourceReceipt.blockNumber);
  if (!Number.isFinite(forkBlock) || forkBlock <= 0) {
    throw new Error(`Invalid FORK_BLOCK: ${process.env.FORK_BLOCK}`);
  }

  await network.provider.request({
    method: "hardhat_reset",
    params: [{ forking: { jsonRpcUrl: rpc, blockNumber: forkBlock } }],
  });

  const replayOrderAgeSeconds = Number(process.env.GMX_REPLAY_ORDER_AGE_SECS || "15");
  const preOrderTimestamp = Number(sourceBlock.timestamp) - replayOrderAgeSeconds;
  await network.provider.send("evm_setNextBlockTimestamp", [preOrderTimestamp]);
  await network.provider.send("evm_mine");

  const iface = new ethers.Interface(orderHandlerArtifact.abi);
  const parsed = iface.parseTransaction({ data: sourceTx.data || "0x", value: sourceTx.value || 0n });
  if (!parsed || parsed.name !== "executeOrder") {
    throw new Error(`Transaction ${executeTxHash} is not executeOrder`);
  }

  const decodedOrderKey = parsed.args[0] as string;
  const oracleParams = toPlainValue(parsed.args[1]);

  const keeperAddress = await resolveKeeperAddress(
    rpc,
    roleStoreAddress,
    forkBlock,
    process.env.GMX_KEEPER_ADDRESS
  );

  await network.provider.request({ method: "hardhat_impersonateAccount", params: [keeperAddress] });
  await network.provider.send("hardhat_setBalance", [keeperAddress, "0x56BC75E2D63100000"]);
  const keeper = await ethers.getSigner(keeperAddress);

  const dataStore = await ethers.getContractAt(
    [
      "function getBytes32Count(bytes32 key) view returns (uint256)",
      "function getBytes32ValuesAt(bytes32 key,uint256 start,uint256 end) view returns (bytes32[])"
    ],
    dataStoreAddress
  );

  const orderListKey = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["ORDER_LIST"]));
  const positionListKey = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["POSITION_LIST"]));

  // Create a fresh pending order on the current fork.
  const ctx = await createContext();
  const user = ctx.users[0];
  await runAction(ctx, { type: "deposit", amountUsd: 1_000n, user });
  await runAction(ctx, { type: "openLong", collateralUsd: 500n, leverageBps: 20_000, user });

  const orderCountBefore = await (dataStore as any).getBytes32Count(orderListKey);
  const positionCountBefore = await (dataStore as any).getBytes32Count(positionListKey);
  const latestOrder = await (dataStore as any).getBytes32ValuesAt(orderListKey, orderCountBefore - 1n, orderCountBefore);
  const createdOrderKey = latestOrder[0] as string;
  const targetOrderKey = (process.env.GMX_ORDER_KEY || createdOrderKey).toLowerCase();

  const orderHandler = new ethers.Contract(orderHandlerAddress, orderHandlerArtifact.abi, keeper);
  const eventEmitterInterface = new ethers.Interface(eventEmitterArtifact.abi);

  console.log("[replay] source tx hash:", executeTxHash);
  console.log("[replay] source tx to:", sourceTx.to);
  console.log("[replay] source tx block:", sourceReceipt.blockNumber.toString());
  console.log("[replay] source block timestamp:", sourceBlock.timestamp.toString());
  console.log("[replay] fork block:", forkBlock.toString());
  console.log("[replay] forced pre-order timestamp:", preOrderTimestamp.toString());
  if ((sourceTx.to || "").toLowerCase() !== orderHandlerAddress.toLowerCase()) {
    console.log(
      "[replay] warning: source tx targets a different handler address; using it only as an oracleParams source"
    );
  }
  console.log("[replay] decoded source key:", decodedOrderKey);
  console.log("[replay] created order key:", createdOrderKey);
  console.log("[replay] target order key:", targetOrderKey);
  console.log("[replay] keeper:", keeperAddress);
  console.log("[replay] ORDER_LIST before:", orderCountBefore.toString());
  console.log("[replay] POSITION_LIST before:", positionCountBefore.toString());

  const executeTx = await (orderHandler as any).executeOrder(targetOrderKey, oracleParams, {
    gasLimit: 8_000_000,
  });
  const executeReceipt = await executeTx.wait();

  const orderCountAfter = await (dataStore as any).getBytes32Count(orderListKey);
  const positionCountAfter = await (dataStore as any).getBytes32Count(positionListKey);
  const latestPosition = positionCountAfter > 0n
    ? await (dataStore as any).getBytes32ValuesAt(positionListKey, positionCountAfter - 1n, positionCountAfter)
    : [];

  console.log("[replay] executeOrder tx:", executeReceipt.hash);
  console.log("[replay] executeOrder status:", String(executeReceipt.status));
  console.log("[replay] executeOrder gasUsed:", executeReceipt.gasUsed.toString());
  console.log("[replay] ORDER_LIST after:", orderCountAfter.toString());
  console.log("[replay] POSITION_LIST after:", positionCountAfter.toString());
  if (latestPosition.length > 0) {
    console.log("[replay] latest position key:", latestPosition[0]);
  }

  for (const log of executeReceipt.logs) {
    if (log.address.toLowerCase() !== eventEmitterArtifact.address.toLowerCase()) {
      continue;
    }

    try {
      const parsedLog = eventEmitterInterface.parseLog(log);
      console.log(`[replay] event: ${parsedLog.name} -> ${parsedLog.args.eventName}`);
      if (parsedLog.args.eventName === "OrderCancelled") {
        const stringItems = parsedLog.args.eventData?.stringItems?.items || [];
        const bytesItems = parsedLog.args.eventData?.bytesItems?.items || [];
        for (const item of stringItems) {
          console.log(`[replay] cancel string ${item.key}: ${item.value}`);
        }
        for (const item of bytesItems) {
          console.log(`[replay] cancel bytes ${item.key}: ${item.value}`);
        }
      }
    } catch {
      // Ignore non-EventEmitter logs that share the same address but are not parseable by this ABI fragment set.
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});