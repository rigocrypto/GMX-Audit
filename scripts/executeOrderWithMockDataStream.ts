import "dotenv/config";

import fs from "fs";
import path from "path";

import { ethers, network } from "hardhat";
import { ethers as rawEthers } from "ethers";
const ERC20_ABI = ["function decimals() view returns (uint8)"];
const DATA_STORE_ABI = [
  "function getBytes32Count(bytes32 key) view returns (uint256)",
  "function getBytes32ValuesAt(bytes32 key,uint256 start,uint256 end) view returns (bytes32[])",
  "function getBytes32(bytes32 key) view returns (bytes32)",
  "function getAddress(bytes32 key) view returns (address)",
  "function getUint(bytes32 key) view returns (uint256)"
];
const ERC20_TRANSFER_ABI = [
  "function decimals() view returns (uint8)",
  "function deposit() payable",
  "function approve(address,uint256) returns (bool)"
];
const PRICE_FEED_ABI = [
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"
];

function deploymentArtifact(fileName: string): { address: string; abi: any[] } {
  const filePath = path.join(process.cwd(), "gmx-synthetics", "deployments", "arbitrum", fileName);
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!payload.address || !Array.isArray(payload.abi)) {
    throw new Error(`Invalid deployment artifact: ${fileName}`);
  }
  return payload;
}

function keyFromString(value: string): string {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["string"], [value]));
}

function hashKey(types: string[], values: unknown[]): string {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(types, values));
}

function encodeReport(params: {
  feedId: string;
  validFromTimestamp: number;
  observationsTimestamp: number;
  expiresAt: number;
  price: bigint;
  bid: bigint;
  ask: bigint;
}): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(bytes32,uint32,uint32,uint192,uint192,uint32,int192,int192,int192)"],
    [
      [
        params.feedId,
        params.validFromTimestamp,
        params.observationsTimestamp,
        0,
        0,
        params.expiresAt,
        params.price,
        params.bid,
        params.ask
      ]
    ]
  );
}

async function resolveKeeperAddress(
  rpc: string,
  roleStoreAddress: string,
  blockTag: number,
  fallback?: string,
  roleName = "ORDER_KEEPER"
): Promise<string> {
  if (fallback) {
    return fallback;
  }

  const provider = new rawEthers.JsonRpcProvider(rpc, 42161);
  const roleStore = new rawEthers.Contract(
    roleStoreAddress,
    ["function getRoleMembers(bytes32 roleKey,uint256 start,uint256 end) view returns (address[])"]
  ).connect(provider);

  const roleKey = rawEthers.keccak256(rawEthers.AbiCoder.defaultAbiCoder().encode(["string"], [roleName]));

  const keepers: string[] = await roleStore.getRoleMembers(roleKey, 0, 1, { blockTag });
  if (!keepers.length) {
    throw new Error(`No ${roleName} found at the selected block. Set an explicit keeper address.`);
  }

  return keepers[0];
}

async function getAdjustedPriceFeedPrice(dataStore: any, tokenAddress: string): Promise<bigint> {
  const priceFeedKey = keyFromString("PRICE_FEED");
  const priceFeedMultiplierKey = keyFromString("PRICE_FEED_MULTIPLIER");
  const priceFeedAddress = await (dataStore as any).getAddress(hashKey(["bytes32", "address"], [priceFeedKey, tokenAddress]));
  if (priceFeedAddress === ethers.ZeroAddress) {
    throw new Error(`Missing price feed for token ${tokenAddress}`);
  }

  const multiplier = BigInt(
    (await (dataStore as any).getUint(hashKey(["bytes32", "address"], [priceFeedMultiplierKey, tokenAddress]))).toString()
  );
  if (multiplier === 0n) {
    throw new Error(`Missing price feed multiplier for token ${tokenAddress}`);
  }

  const priceFeed = await ethers.getContractAt(PRICE_FEED_ABI, priceFeedAddress);
  const [, latestAnswer] = await (priceFeed as any).latestRoundData();
  const answer = BigInt(latestAnswer.toString());
  return (answer * multiplier) / 10n ** 30n;
}

async function main() {
  const rpc = process.env.ARBITRUM_RPC_URL || process.env.ARBITRUM_RPC;
  if (!rpc) {
    throw new Error("Missing ARBITRUM_RPC_URL or ARBITRUM_RPC");
  }

  if (process.env.GMX_ENABLE_REAL_MUTATIONS !== "1") {
    throw new Error("Set GMX_ENABLE_REAL_MUTATIONS=1 before running executeOrderWithMockDataStream.ts");
  }

  const forkBlock = process.env.FORK_BLOCK ? Number(process.env.FORK_BLOCK) : 403540360;
  if (!Number.isFinite(forkBlock) || forkBlock <= 0) {
    throw new Error(`Invalid FORK_BLOCK: ${process.env.FORK_BLOCK}`);
  }

  await network.provider.request({
    method: "hardhat_reset",
    params: [{ forking: { jsonRpcUrl: rpc, blockNumber: forkBlock } }]
  });
  await network.provider.send("evm_mine");

  const dataStoreArtifact = deploymentArtifact("DataStore.json");
  const roleStoreArtifact = deploymentArtifact("RoleStore.json");
  const orderHandlerArtifact = deploymentArtifact("OrderHandler.json");
  const liquidationHandlerArtifact = deploymentArtifact("LiquidationHandler.json");
  const exchangeRouterArtifact = deploymentArtifact("ExchangeRouter.json");
  const routerArtifact = deploymentArtifact("Router.json");
  const orderVaultArtifact = deploymentArtifact("OrderVault.json");
  const chainlinkDataStreamProviderArtifact = deploymentArtifact("ChainlinkDataStreamProvider.json");
  const eventEmitterArtifact = deploymentArtifact("EventEmitter.json");
  const readerArtifact = deploymentArtifact("Reader.json");

  const dataStore = await ethers.getContractAt(DATA_STORE_ABI, dataStoreArtifact.address);
  const dataStreamProvider = await ethers.getContractAt(
    [...chainlinkDataStreamProviderArtifact.abi, "function verifier() view returns (address)"],
    chainlinkDataStreamProviderArtifact.address
  );

  const verifierAddress = await (dataStreamProvider as any).verifier();
  const mockVerifier = await ethers.deployContract("MockChainlinkDataStreamVerifier");
  await mockVerifier.waitForDeployment();
  const mockRuntimeCode = await ethers.provider.getCode(await mockVerifier.getAddress());
  await network.provider.send("hardhat_setCode", [verifierAddress, mockRuntimeCode]);

  const keeperAddress = await resolveKeeperAddress(
    rpc,
    roleStoreArtifact.address,
    forkBlock,
    process.env.GMX_KEEPER_ADDRESS
  );
  const liquidationKeeperAddress = await resolveKeeperAddress(
    rpc,
    roleStoreArtifact.address,
    forkBlock,
    process.env.GMX_LIQUIDATION_KEEPER_ADDRESS,
    "LIQUIDATION_KEEPER"
  );
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [keeperAddress] });
  await network.provider.send("hardhat_setBalance", [keeperAddress, "0x56BC75E2D63100000"]);
  const keeper = await ethers.getSigner(keeperAddress);
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [liquidationKeeperAddress] });
  await network.provider.send("hardhat_setBalance", [liquidationKeeperAddress, "0x56BC75E2D63100000"]);
  const liquidationKeeper = await ethers.getSigner(liquidationKeeperAddress);

  const depositUsd = BigInt(process.env.GMX_MOCK_DEPOSIT_USD || "2500");
  const collateralUsd = BigInt(process.env.GMX_MOCK_COLLATERAL_USD || "1000");
  const leverageBps = Number(process.env.GMX_MOCK_LEVERAGE_BPS || "10000");

  const orderListKey = keyFromString("ORDER_LIST");
  const positionListKey = keyFromString("POSITION_LIST");

  const orderCountBefore = await (dataStore as any).getBytes32Count(orderListKey);
  const positionCountBefore = await (dataStore as any).getBytes32Count(positionListKey);

  const wethAddress = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
  const usdcAddress = process.env.GMX_COLLATERAL_TOKEN || "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
  const weth = await ethers.getContractAt(ERC20_TRANSFER_ABI, wethAddress);
  const usdc = await ethers.getContractAt(ERC20_ABI, usdcAddress);
  const wethDecimals = Number(await (weth as any).decimals());
  const usdcDecimals = Number(await (usdc as any).decimals());

  const dataStreamIdKey = keyFromString("DATA_STREAM_ID");
  const dataStreamMultiplierKey = keyFromString("DATA_STREAM_MULTIPLIER");
  const wethFeedId = await (dataStore as any).getBytes32(hashKey(["bytes32", "address"], [dataStreamIdKey, wethAddress]));
  const usdcFeedId = await (dataStore as any).getBytes32(hashKey(["bytes32", "address"], [dataStreamIdKey, usdcAddress]));
  const wethMultiplier = BigInt(
    (await (dataStore as any).getUint(hashKey(["bytes32", "address"], [dataStreamMultiplierKey, wethAddress]))).toString()
  );
  const usdcMultiplier = BigInt(
    (await (dataStore as any).getUint(hashKey(["bytes32", "address"], [dataStreamMultiplierKey, usdcAddress]))).toString()
  );

  const wethPriceUsd = BigInt(process.env.GMX_WETH_PRICE || "2000");
  const usdcPriceUsd = BigInt(process.env.GMX_USDC_PRICE || "1");
  const wethPrice = process.env.GMX_WETH_PRICE
    ? ethers.parseUnits(process.env.GMX_WETH_PRICE, 30 - wethDecimals)
    : await getAdjustedPriceFeedPrice(dataStore, wethAddress);
  const usdcPrice = process.env.GMX_USDC_PRICE
    ? ethers.parseUnits(process.env.GMX_USDC_PRICE, 30 - usdcDecimals)
    : await getAdjustedPriceFeedPrice(dataStore, usdcAddress);
  const wethRaw = (wethPrice * 10n ** 30n) / wethMultiplier;
  const usdcRaw = (usdcPrice * 10n ** 30n) / usdcMultiplier;
  const collateralAmount = (collateralUsd * 10n ** BigInt(wethDecimals) * usdcPriceUsd) / wethPriceUsd;
  const sizeDeltaUsd = collateralUsd * BigInt(leverageBps) * 10n ** 30n / 10_000n;
  const executionFee = BigInt(process.env.GMX_EXECUTION_FEE_WEI || "8000000000000000");

  const [, userSigner] = await ethers.getSigners();
  const userAddress = await userSigner.getAddress();
  const requiredNativeBalance = collateralAmount + executionFee + ethers.parseEther("1");
  await network.provider.send("hardhat_setBalance", [userAddress, ethers.toBeHex(requiredNativeBalance)]);
  await (weth.connect(userSigner) as any).deposit({ value: collateralAmount });

  const exchangeRouter = new ethers.Contract(exchangeRouterArtifact.address, exchangeRouterArtifact.abi, userSigner);
  await (weth.connect(userSigner) as any).approve(routerArtifact.address, collateralAmount);

  const orderParams = {
    addresses: {
      receiver: userAddress,
      cancellationReceiver: userAddress,
      callbackContract: ethers.ZeroAddress,
      uiFeeReceiver: ethers.ZeroAddress,
      market: process.env.GMX_MARKET_ADDRESS || "0x70d95587d40A2caf56bd97485aB3Eec10Bee6336",
      initialCollateralToken: wethAddress,
      swapPath: []
    },
    numbers: {
      sizeDeltaUsd,
      initialCollateralDeltaAmount: collateralAmount,
      triggerPrice: 0,
      acceptablePrice: ethers.MaxUint256,
      executionFee,
      callbackGasLimit: 0,
      minOutputAmount: 0,
      validFromTime: 0
    },
    orderType: 2,
    decreasePositionSwapType: 0,
    isLong: true,
    shouldUnwrapNativeToken: false,
    autoCancel: false,
    referralCode: ethers.ZeroHash,
    dataList: []
  };

  const routerWithUser = exchangeRouter.connect(userSigner) as any;
  const sendWntData = routerWithUser.interface.encodeFunctionData("sendWnt", [orderVaultArtifact.address, executionFee]);
  const sendTokensData = routerWithUser.interface.encodeFunctionData("sendTokens", [
    wethAddress,
    orderVaultArtifact.address,
    collateralAmount
  ]);
  const createOrderData = routerWithUser.interface.encodeFunctionData("createOrder", [orderParams]);
  const createOrderTx = await routerWithUser.multicall([sendWntData, sendTokensData, createOrderData], {
    value: executionFee,
    gasLimit: 4_000_000
  });
  const createOrderReceipt = await createOrderTx.wait();
  const createOrderBlock = await ethers.provider.getBlock(createOrderReceipt.blockNumber);
  if (!createOrderBlock) {
    throw new Error("Failed to fetch createOrder block");
  }

  const orderCountAfterCreate = await (dataStore as any).getBytes32Count(orderListKey);
  const latestOrder = await (dataStore as any).getBytes32ValuesAt(orderListKey, orderCountAfterCreate - 1n, orderCountAfterCreate);
  const orderKey = latestOrder[0] as string;

  const observationTimestamp = Number(createOrderBlock.timestamp) + 5;
  const validFromTimestamp = observationTimestamp - 2;
  const expiresAt = observationTimestamp + 3600;

  const oracleParams = {
    tokens: [wethAddress, usdcAddress],
    providers: [chainlinkDataStreamProviderArtifact.address, chainlinkDataStreamProviderArtifact.address],
    data: [
      encodeReport({
        feedId: wethFeedId,
        validFromTimestamp,
        observationsTimestamp: observationTimestamp,
        expiresAt,
        price: wethRaw,
        bid: wethRaw,
        ask: wethRaw
      }),
      encodeReport({
        feedId: usdcFeedId,
        validFromTimestamp,
        observationsTimestamp: observationTimestamp,
        expiresAt,
        price: usdcRaw,
        bid: usdcRaw,
        ask: usdcRaw
      })
    ]
  };

  const orderHandler = new ethers.Contract(orderHandlerArtifact.address, orderHandlerArtifact.abi, keeper);
  const liquidationHandler = new ethers.Contract(
    liquidationHandlerArtifact.address,
    liquidationHandlerArtifact.abi,
    liquidationKeeper
  );
  const eventEmitterInterface = new ethers.Interface(eventEmitterArtifact.abi);
  const reader = new ethers.Contract(readerArtifact.address, readerArtifact.abi, keeper);

  console.log("[mock-exec] fork block:", forkBlock.toString());
  console.log("[mock-exec] keeper:", keeperAddress);
  console.log("[liquidation] keeper:", liquidationKeeperAddress);
  console.log("[mock-exec] verifier address:", verifierAddress);
  console.log("[mock-exec] mock verifier:", await mockVerifier.getAddress());
  console.log("[mock-exec] order key:", orderKey);
  console.log("[mock-exec] deposit/collateral/leverage:", depositUsd.toString(), collateralUsd.toString(), leverageBps);
  console.log("[mock-exec] collateral amount:", collateralAmount.toString());
  console.log("[mock-exec] size delta usd:", sizeDeltaUsd.toString());
  console.log("[mock-exec] ORDER_LIST before:", orderCountBefore.toString());
  console.log("[mock-exec] ORDER_LIST after create:", orderCountAfterCreate.toString());
  console.log("[mock-exec] POSITION_LIST before:", positionCountBefore.toString());
  console.log("[mock-exec] WETH feed/multiplier:", wethFeedId, wethMultiplier.toString());
  console.log("[mock-exec] USDC feed/multiplier:", usdcFeedId, usdcMultiplier.toString());
  console.log("[mock-exec] WETH target/raw price:", wethPrice.toString(), wethRaw.toString());
  console.log("[mock-exec] USDC target/raw price:", usdcPrice.toString(), usdcRaw.toString());

  const order = await (reader as any).getOrder(dataStoreArtifact.address, orderKey);
  console.log("[order] flags:");
  console.log("  orderType:", order.numbers.orderType.toString());
  console.log("  isLong:", order.flags.isLong);
  console.log(
    "  sizeDeltaUsd:",
    order.numbers.sizeDeltaUsd.toString(),
    "=",
    (Number(order.numbers.sizeDeltaUsd) / 1e30).toFixed(2),
    "USD"
  );
  console.log("  initialCollateralDeltaAmount:", order.numbers.initialCollateralDeltaAmount.toString());
  console.log("  acceptablePrice:", order.numbers.acceptablePrice.toString());
  console.log("  triggerPrice:", order.numbers.triggerPrice.toString());
  console.log("  market:", order.addresses.market);
  console.log("  initialCollateralToken:", order.addresses.initialCollateralToken);
  console.log("  account:", order.addresses.account);

  await network.provider.send("evm_setNextBlockTimestamp", [observationTimestamp + 1]);
  await network.provider.send("evm_mine");

  try {
    await (orderHandler as any).executeOrder.staticCall(orderKey, oracleParams, { gasLimit: 8_000_000 });
    console.log("[simulate] no revert - proceeding to real call");
  } catch (simErr: any) {
    console.log("[simulate] REVERT data:", simErr?.data ?? simErr?.error?.data ?? "(no data)");
    console.log("[simulate] REVERT message:", simErr?.message?.slice(0, 300));
  }

  const oracleTokens =
    (oracleParams as any).tokens ??
    (Array.isArray(oracleParams) ? (oracleParams as any)[1] : undefined);
  console.log("[oracle] tokens in params:", oracleTokens);

  const erc20Mini = ["function balanceOf(address) view returns (uint256)"];
  const wethC = await ethers.getContractAt(erc20Mini, wethAddress);
  const usdcC = await ethers.getContractAt(erc20Mini, usdcAddress);
  console.log("[vault] OrderVault WETH:", (await (wethC as any).balanceOf(orderVaultArtifact.address)).toString());
  console.log("[vault] OrderVault USDC:", (await (usdcC as any).balanceOf(orderVaultArtifact.address)).toString());

  const executeTx = await (orderHandler as any).executeOrder(orderKey, oracleParams, {
    gasLimit: 8_000_000
  });
  const executeReceipt = await executeTx.wait();

  const eeJ = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "gmx-synthetics", "deployments", "arbitrum", "EventEmitter.json"), "utf8")
  );
  const eeIface = new ethers.Interface(eeJ.abi);

  for (const log of executeReceipt.logs) {
    if (log.address.toLowerCase() !== String(eeJ.address).toLowerCase()) {
      continue;
    }

    try {
      const parsed = eeIface.parseLog({ topics: log.topics as string[], data: log.data as string });
      if (!parsed) {
        continue;
      }

      const eventName = (parsed.args as any).eventName ?? parsed.args[1] ?? "";
      const eventData = (parsed.args as any).eventData ?? parsed.args[2];
      if (String(eventName).includes("OraclePriceUpdate")) {
        const addressItems = eventData?.addressItems?.items ?? [];
        const uintItems = eventData?.uintItems?.items ?? [];
        const tokenItem = addressItems.find((i: any) => i[0] === "token" || i?.key === "token");
        const minItem = uintItems.find((i: any) => i[0] === "minPrice" || i?.key === "minPrice");
        const maxItem = uintItems.find((i: any) => i[0] === "maxPrice" || i?.key === "maxPrice");
        const tokenValue = tokenItem?.[1] ?? tokenItem?.value;
        const minValue = minItem?.[1] ?? minItem?.value;
        const maxValue = maxItem?.[1] ?? maxItem?.value;
        console.log(
          "[OraclePriceUpdate] token:",
          tokenValue,
          "minPrice:",
          minValue?.toString?.() ?? String(minValue),
          "maxPrice:",
          maxValue?.toString?.() ?? String(maxValue)
        );
        continue;
      }

      if (!String(eventName).includes("Order")) {
        continue;
      }

      const bytesItems = eventData?.bytesItems?.items ?? [];
      const stringItems = eventData?.stringItems?.items ?? [];

      console.log(
        "[EE] bytesItems:",
        JSON.stringify(bytesItems, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
      );
      console.log(
        "[EE] stringItems:",
        JSON.stringify(stringItems, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
      );
    } catch {
      // ignore logs outside EventEmitter ABI fragments
    }
  }

  const orderCountAfter = await (dataStore as any).getBytes32Count(orderListKey);
  const positionCountAfter = await (dataStore as any).getBytes32Count(positionListKey);
  const latestPosition =
    positionCountAfter > 0n
      ? await (dataStore as any).getBytes32ValuesAt(positionListKey, positionCountAfter - 1n, positionCountAfter)
      : [];

  console.log("[mock-exec] executeOrder tx:", executeReceipt.hash);
  console.log("[mock-exec] executeOrder status:", String(executeReceipt.status));
  console.log("[mock-exec] executeOrder gasUsed:", executeReceipt.gasUsed.toString());
  console.log("[mock-exec] ORDER_LIST after:", orderCountAfter.toString());
  console.log("[mock-exec] POSITION_LIST after:", positionCountAfter.toString());
  if (latestPosition.length > 0) {
    console.log("[mock-exec] latest position key:", latestPosition[0]);
  }

  // Compute the expected position key using the same account/market/collateral/isLong tuple.
  const computedPositionKey = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "address", "bool"],
      [userAddress, orderParams.addresses.market, wethAddress, true]
    )
  );
  const position = await (reader as any).getPosition(dataStoreArtifact.address, computedPositionKey);
  const actualCollateral = BigInt(position.numbers.collateralAmount.toString());

  let positionFeeAmount = 0n;
  for (const log of executeReceipt.logs) {
    if (log.address.toLowerCase() !== String(eeJ.address).toLowerCase()) {
      continue;
    }
    try {
      const parsed = eeIface.parseLog({ topics: log.topics as string[], data: log.data as string });
      if (!parsed) {
        continue;
      }
      const eventName = String((parsed.args as any).eventName ?? parsed.args[1] ?? "");
      if (eventName !== "PositionFeesCollected") {
        continue;
      }
      const eventData = (parsed.args as any).eventData ?? parsed.args[2];
      const uintItems = eventData?.uintItems?.items ?? [];
      for (const item of uintItems) {
        const key = item?.[0] ?? item?.key;
        const value = item?.[1] ?? item?.value;
        if (key === "positionFeeAmount") {
          positionFeeAmount = BigInt(value.toString());
        }
      }
    } catch {
      // ignore logs outside EventEmitter ABI fragments
    }
  }

  const expectedCollateral = collateralAmount;
  const expectedNet = expectedCollateral - positionFeeAmount;
  const feeMatch = actualCollateral === expectedNet;
  console.log("POSITION_KEY:", computedPositionKey);
  console.log("EXPECTED_COLLATERAL:", expectedCollateral.toString());
  console.log("POSITION_FEE_AMOUNT:", positionFeeAmount.toString());
  console.log("COLLATERAL_NET_OF_FEES:", expectedNet.toString());
  console.log("ACTUAL_COLLATERAL:", actualCollateral.toString());
  console.log("FEE_ACCOUNTING_EXACT:", feeMatch);
  if (!feeMatch) {
    throw new Error(`Fee accounting mismatch: expected ${expectedNet} got ${actualCollateral}`);
  }

  // Partial close invariant: attempt to over-withdraw collateral and verify it does not increase position collateral.
  const positionCollateralBeforeClose = actualCollateral;
  const decreaseParams = {
    addresses: {
      receiver: userAddress,
      cancellationReceiver: userAddress,
      callbackContract: ethers.ZeroAddress,
      uiFeeReceiver: ethers.ZeroAddress,
      market: orderParams.addresses.market,
      initialCollateralToken: wethAddress,
      swapPath: []
    },
    numbers: {
      sizeDeltaUsd: ethers.parseUnits("1", 30),
      initialCollateralDeltaAmount: positionCollateralBeforeClose + ethers.parseEther("1"),
      triggerPrice: 0,
      acceptablePrice: 0n, // for long decrease: 0 = accept any price, so execution reaches collateral validation
      executionFee,
      callbackGasLimit: 0,
      minOutputAmount: 0,
      validFromTime: 0
    },
    orderType: 4,
    decreasePositionSwapType: 0,
    isLong: true,
    shouldUnwrapNativeToken: false,
    autoCancel: false,
    referralCode: ethers.ZeroHash,
    dataList: []
  };

  const wethBalBefore = await (wethC as any).balanceOf(userAddress);
  console.log("[close] signer WETH before:", wethBalBefore.toString());

  const closeSendWnt = routerWithUser.interface.encodeFunctionData("sendWnt", [orderVaultArtifact.address, executionFee]);
  const closeCreateOrder = routerWithUser.interface.encodeFunctionData("createOrder", [decreaseParams]);
  const closeTx = await routerWithUser.multicall([closeSendWnt, closeCreateOrder], {
    value: executionFee,
    gasLimit: 4_000_000
  });
  const closeReceipt = await closeTx.wait();
  console.log("[close] createOrder tx:", closeReceipt.hash, "status:", String(closeReceipt.status));

  const closeOrderCountAfterCreate = await (dataStore as any).getBytes32Count(orderListKey);
  const closeOrderKeys = await (dataStore as any).getBytes32ValuesAt(
    orderListKey,
    closeOrderCountAfterCreate - 1n,
    closeOrderCountAfterCreate
  );
  const closeOrderKey = closeOrderKeys[0];
  console.log("[close] order key:", closeOrderKey);

  const closeBlock = await ethers.provider.getBlock("latest");
  if (!closeBlock) {
    throw new Error("Failed to fetch close-order block");
  }

  const closeObservationTimestamp = Number(closeBlock.timestamp) + 5;
  const closeValidFromTimestamp = closeObservationTimestamp - 2;
  const closeExpiresAt = closeObservationTimestamp + 3600;

  const closeOracleParams = {
    tokens: [wethAddress, usdcAddress],
    providers: [chainlinkDataStreamProviderArtifact.address, chainlinkDataStreamProviderArtifact.address],
    data: [
      encodeReport({
        feedId: wethFeedId,
        validFromTimestamp: closeValidFromTimestamp,
        observationsTimestamp: closeObservationTimestamp,
        expiresAt: closeExpiresAt,
        price: wethRaw,
        bid: wethRaw,
        ask: wethRaw
      }),
      encodeReport({
        feedId: usdcFeedId,
        validFromTimestamp: closeValidFromTimestamp,
        observationsTimestamp: closeObservationTimestamp,
        expiresAt: closeExpiresAt,
        price: usdcRaw,
        bid: usdcRaw,
        ask: usdcRaw
      })
    ]
  };

  await network.provider.send("evm_setNextBlockTimestamp", [closeObservationTimestamp + 1]);
  await network.provider.send("evm_mine");

  const closeExecuteTx = await (orderHandler as any).executeOrder(closeOrderKey, closeOracleParams, {
    gasLimit: 8_000_000
  });
  const closeExecuteReceipt = await closeExecuteTx.wait();
  console.log("[close] executeOrder tx:", closeExecuteReceipt.hash, "status:", String(closeExecuteReceipt.status));

  let closeCancelled = false;
  for (const log of closeExecuteReceipt.logs) {
    if (log.address.toLowerCase() !== eventEmitterArtifact.address.toLowerCase()) {
      continue;
    }
    try {
      const parsedLog = eventEmitterInterface.parseLog(log);
      const eventName = String(parsedLog.args.eventName ?? "");
      if (eventName !== "OrderCancelled") {
        continue;
      }
      closeCancelled = true;
      console.log("[close] OrderCancelled detected");
      const eventData = parsedLog.args.eventData;
      for (const item of eventData?.stringItems?.items || []) {
        console.log(`[close] cancel string ${item.key}: ${item.value}`);
      }
      for (const item of eventData?.uintItems?.items || []) {
        console.log(`[close] cancel uint ${item.key}: ${item.value}`);
      }
      for (const item of eventData?.bytesItems?.items || []) {
        console.log(`[close] cancel bytes ${item.key}: ${item.value}`);
      }
    } catch {
      // ignore logs outside EventEmitter ABI fragments
    }
  }

  const wethBalAfter = await (wethC as any).balanceOf(userAddress);
  const wethBalDelta = BigInt(wethBalAfter.toString()) - BigInt(wethBalBefore.toString());
  console.log("[close] signer WETH after:", wethBalAfter.toString());
  console.log("[close] signer WETH delta:", wethBalDelta.toString());

  const positionAfterClose = await (reader as any).getPosition(dataStoreArtifact.address, computedPositionKey);
  const collateralAfterClose = BigInt(positionAfterClose.numbers.collateralAmount.toString());
  console.log("[close] collateral before:", positionCollateralBeforeClose.toString());
  console.log("[close] collateral after:", collateralAfterClose.toString());
  if (closeCancelled) {
    console.log("[close] cancel outcome: true");
  }
  if (wethBalDelta > 0n) {
    throw new Error(
      `INVARIANT VIOLATED: signer received ${wethBalDelta} WETH from a cancelled close order`
    );
  }
  console.log("[close] WETH_LEAK_ON_CANCEL: NONE (delta " + wethBalDelta.toString() + ")");
  if (collateralAfterClose > positionCollateralBeforeClose) {
    throw new Error(
      `INVARIANT VIOLATED: collateral increased from ${positionCollateralBeforeClose} to ${collateralAfterClose} without deposit`
    );
  }
  console.log("[close] OVER_WITHDRAW_INVARIANT: HOLDS");

  const maxRefPriceDeviationFactorKey = keyFromString("MAX_ORACLE_REF_PRICE_DEVIATION_FACTOR");
  const poolAmountKey = keyFromString("POOL_AMOUNT");
  const maxRefPriceDeviationFactor = BigInt(
    (await (dataStore as any).getUint(maxRefPriceDeviationFactorKey)).toString()
  );
  let liquidationWethPrice = process.env.GMX_LIQUIDATION_WETH_PRICE
    ? ethers.parseUnits(process.env.GMX_LIQUIDATION_WETH_PRICE, 30 - wethDecimals)
    : (wethPrice * 75n) / 100n;
  const sizeBeforeLiquidation = BigInt(positionAfterClose.numbers.sizeInUsd.toString());
  const collateralBeforeLiquidation = BigInt(positionAfterClose.numbers.collateralAmount.toString());
  if (sizeBeforeLiquidation === 0n) {
    throw new Error("Position was unexpectedly closed before liquidation test");
  }

  const wethPoolKey = hashKey(["bytes32", "address", "address"], [poolAmountKey, orderParams.addresses.market, wethAddress]);
  const usdcPoolKey = hashKey(["bytes32", "address", "address"], [poolAmountKey, orderParams.addresses.market, usdcAddress]);
  const wethPoolBeforeLiquidation = BigInt((await (dataStore as any).getUint(wethPoolKey)).toString());
  const usdcPoolBeforeLiquidation = BigInt((await (dataStore as any).getUint(usdcPoolKey)).toString());
  const buildLiquidationOracleParams = async (targetPrice: bigint) => {
    const targetRaw = (targetPrice * 10n ** 30n) / wethMultiplier;
    const liquidationBlock = await ethers.provider.getBlock("latest");
    if (!liquidationBlock) {
      throw new Error("Failed to fetch liquidation block");
    }

    const liquidationObservationTimestamp = Number(liquidationBlock.timestamp) + 5;
    const liquidationValidFromTimestamp = liquidationObservationTimestamp - 2;
    const liquidationExpiresAt = liquidationObservationTimestamp + 3600;
    const oracleParams = {
      tokens: [wethAddress, usdcAddress],
      providers: [chainlinkDataStreamProviderArtifact.address, chainlinkDataStreamProviderArtifact.address],
      data: [
        encodeReport({
          feedId: wethFeedId,
          validFromTimestamp: liquidationValidFromTimestamp,
          observationsTimestamp: liquidationObservationTimestamp,
          expiresAt: liquidationExpiresAt,
          price: targetRaw,
          bid: targetRaw,
          ask: targetRaw
        }),
        encodeReport({
          feedId: usdcFeedId,
          validFromTimestamp: liquidationValidFromTimestamp,
          observationsTimestamp: liquidationObservationTimestamp,
          expiresAt: liquidationExpiresAt,
          price: usdcRaw,
          bid: usdcRaw,
          ask: usdcRaw
        })
      ]
    };

    await network.provider.send("evm_setNextBlockTimestamp", [liquidationObservationTimestamp + 1]);
    await network.provider.send("evm_mine");

    return { oracleParams, targetRaw };
  };

  let liquidationBuild = await buildLiquidationOracleParams(liquidationWethPrice);
  try {
    await (liquidationHandler as any).executeLiquidation.staticCall(
      userAddress,
      orderParams.addresses.market,
      wethAddress,
      true,
      liquidationBuild.oracleParams,
      { gasLimit: 8_000_000 }
    );
  } catch (error: any) {
    const revertData = error?.data ?? error?.error?.data;
    if (typeof revertData !== "string" || revertData.slice(0, 10).toLowerCase() !== "0x3d1986f7") {
      throw error;
    }

    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      ["address", "uint256", "uint256", "uint256"],
      `0x${revertData.slice(10)}`
    );
    const refPrice = BigInt(decoded[2].toString());
    liquidationWethPrice = refPrice - (refPrice * maxRefPriceDeviationFactor) / 10n ** 30n + 1n;
    console.log("[liquidation] adjusted target price from ref price:", liquidationWethPrice.toString());
    liquidationBuild = await buildLiquidationOracleParams(liquidationWethPrice);
    await (liquidationHandler as any).executeLiquidation.staticCall(
      userAddress,
      orderParams.addresses.market,
      wethAddress,
      true,
      liquidationBuild.oracleParams,
      { gasLimit: 8_000_000 }
    );
  }

  console.log("[liquidation] max ref deviation factor:", maxRefPriceDeviationFactor.toString());
  console.log("[liquidation] WETH price target/raw:", liquidationWethPrice.toString(), liquidationBuild.targetRaw.toString());
  console.log("[liquidation] size before:", sizeBeforeLiquidation.toString());
  console.log("[liquidation] collateral before:", collateralBeforeLiquidation.toString());

  const liquidationTx = await (liquidationHandler as any).executeLiquidation(
    userAddress,
    orderParams.addresses.market,
    wethAddress,
    true,
    liquidationBuild.oracleParams,
    { gasLimit: 8_000_000 }
  );
  const liquidationReceipt = await liquidationTx.wait();
  console.log("[liquidation] executeLiquidation tx:", liquidationReceipt.hash, "status:", String(liquidationReceipt.status));

  const positionAfterLiquidation = await (reader as any).getPosition(dataStoreArtifact.address, computedPositionKey);
  const sizeAfterLiquidation = BigInt(positionAfterLiquidation.numbers.sizeInUsd.toString());
  const collateralAfterLiquidation = BigInt(positionAfterLiquidation.numbers.collateralAmount.toString());
  const positionCountAfterLiquidation = await (dataStore as any).getBytes32Count(positionListKey);
  const wethPoolAfterLiquidation = BigInt((await (dataStore as any).getUint(wethPoolKey)).toString());
  const usdcPoolAfterLiquidation = BigInt((await (dataStore as any).getUint(usdcPoolKey)).toString());

  console.log("[liquidation] position size after:", sizeAfterLiquidation.toString());
  console.log("[liquidation] position collateral after:", collateralAfterLiquidation.toString());
  console.log("[liquidation] POSITION_LIST after:", positionCountAfterLiquidation.toString());
  console.log("[liquidation] pool WETH before:", wethPoolBeforeLiquidation.toString());
  console.log("[liquidation] pool WETH after:", wethPoolAfterLiquidation.toString());
  console.log("[liquidation] pool USDC before:", usdcPoolBeforeLiquidation.toString());
  console.log("[liquidation] pool USDC after:", usdcPoolAfterLiquidation.toString());

  if (sizeAfterLiquidation !== 0n || collateralAfterLiquidation !== 0n) {
    throw new Error(
      `LIQUIDATION FAILED: size ${sizeAfterLiquidation} collateral ${collateralAfterLiquidation}`
    );
  }
  if (positionCountAfterLiquidation !== positionCountBefore) {
    throw new Error(
      `LIQUIDATION FAILED: expected POSITION_LIST ${positionCountBefore} got ${positionCountAfterLiquidation}`
    );
  }
  console.log("[liquidation] SOLVENCY_HOLDS: true");

  for (const log of executeReceipt.logs) {
    if (log.address.toLowerCase() !== eventEmitterArtifact.address.toLowerCase()) {
      continue;
    }

    try {
      const parsedLog = eventEmitterInterface.parseLog(log);
      console.log(`[mock-exec] event: ${parsedLog.name} -> ${parsedLog.args.eventName}`);
      if (parsedLog.args.eventName === "OraclePriceUpdate") {
        const eventData = parsedLog.args.eventData;
        for (const item of eventData?.addressItems?.items || []) {
          console.log(`[mock-exec] oracle address ${item.key}: ${item.value}`);
        }
        for (const item of eventData?.uintItems?.items || []) {
          console.log(`[mock-exec] oracle uint ${item.key}: ${item.value}`);
          if (item.key === "minPrice" || item.key === "maxPrice") {
            const scaled = Number(item.value) / 1e30;
            console.log(`[mock-exec] oracle uint ${item.key} scaled_30dec: ${scaled}`);
          }
        }
      }
      if (parsedLog.args.eventName === "OrderCancelled") {
        const eventData = parsedLog.args.eventData;
        for (const item of eventData?.stringItems?.items || []) {
          console.log(`[mock-exec] cancel string ${item.key}: ${item.value}`);
        }
        for (const item of eventData?.addressItems?.items || []) {
          console.log(`[mock-exec] cancel address ${item.key}: ${item.value}`);
        }
        for (const item of eventData?.uintItems?.items || []) {
          console.log(`[mock-exec] cancel uint ${item.key}: ${item.value}`);
        }
        for (const item of eventData?.bytesItems?.items || []) {
          console.log(`[mock-exec] cancel bytes ${item.key}: ${item.value}`);
        }
      }
    } catch {
      // ignore logs outside the ABI fragments we care about
    }
  }

  // Dump fee and position uint fields to map collateral delta to protocol fee components.
  for (const log of executeReceipt.logs) {
    if (log.address.toLowerCase() !== eventEmitterArtifact.address.toLowerCase()) {
      continue;
    }

    try {
      const parsedLog = eventEmitterInterface.parseLog(log);
      const eventName = String(parsedLog.args.eventName ?? parsedLog.args[1] ?? "");
      if (!eventName.includes("Fee") && !eventName.includes("Position")) {
        continue;
      }

      const eventData = parsedLog.args.eventData ?? parsedLog.args[2];
      const uintItems = eventData?.uintItems?.items ?? [];
      if (uintItems.length === 0) {
        continue;
      }

      console.log("[FEE-EE]", eventName);
      for (const item of uintItems) {
        const key = item?.[0] ?? item?.key;
        const value = item?.[1] ?? item?.value;
        console.log("  ", key, "=", value?.toString?.() ?? String(value));
      }
    } catch {
      // ignore logs outside the ABI fragments we care about
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});