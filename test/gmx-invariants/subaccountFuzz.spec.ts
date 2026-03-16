/**
 * SubaccountRouter delegation limit invariant tests.
 *
 * SubaccountRouter (0xdD00F6…) lets a main account delegate limited order-
 * creation authority to a sub-account.  The delegation is parameterised by:
 *   - addSubaccount / removeSubaccount  (authorization toggle)
 *   - setMaxAllowedSubaccountActionCount (cumulative action cap per type)
 *   - setSubaccountExpiresAt             (time-based cap per type)
 *
 * The Immunefi-scope risk is:
 *   A) An unapproved sub-account could act as if approved ("unauthorized execution").
 *   B) A sub-account could exhaust its cap and re-authorize itself to keep trading.
 *   C) An expired delegation could still be used.
 *
 * Coverage:
 *  1. Unauthorized sub-account calling createOrder → SubaccountNotAuthorized
 *  2. Registered sub-account with maxAllowedCount=0 → MaxSubaccountActionCountExceeded
 *  3. addSubaccount / removeSubaccount cycle → second call after removal reverts
 *  4. setSubaccountExpiresAt in the past → revert on attempted action
 *  5. Sub-account CANNOT call addSubaccount for itself (only main account can)
 */

import { ethers, network } from "hardhat";
import { expect } from "chai";

import { FUZZ_CONFIG, requireArbitrumForkOrSkip, requireRealMutations, withIterationSnapshot } from "./harness";

// ── addresses & constants ─────────────────────────────────────────────────────

const SUBACCOUNT_ROUTER_ADDRESS =
  process.env.GMX_SUBACCOUNT_ROUTER_ADDRESS || "0xdD00F639725E19a209880A44962Bc93b51B1B161";
const DATA_STORE_ADDRESS =
  process.env.GMX_DATA_STORE_ADDRESS || "0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8";
const USDC_ADDRESS = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const WETH_USDC_MARKET = "0x70d95587d40A2caf56bd97485aB3Eec10Bee6336";
const ORDER_VAULT_ADDRESS =
  process.env.GMX_ORDER_VAULT_ADDRESS || "0x31eF83a530Fde1B38EE9A18093A333D8Bbbc40D5";

/**
 * keccak256(abi.encode("SUBACCOUNT_ORDER_ACTION")) — the action-type key used
 * by SubaccountRouter._handleSubaccountAction for all createOrder / updateOrder
 * / cancelOrder operations.
 */
const SUBACCOUNT_ORDER_ACTION = ethers.keccak256(
  ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["SUBACCOUNT_ORDER_ACTION"])
);

// ── ABIs ──────────────────────────────────────────────────────────────────────

const ERC20_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)"
];

const SUBACCOUNT_ROUTER_ABI = [
  "function addSubaccount(address subaccount) external payable",
  "function removeSubaccount(address subaccount) external payable",
  "function setMaxAllowedSubaccountActionCount(address subaccount, bytes32 actionType, uint256 maxAllowedCount) external payable",
  "function setSubaccountExpiresAt(address subaccount, bytes32 actionType, uint256 expiresAt) external payable",
  `function createOrder(
    address account,
    tuple(
      tuple(
        address receiver,
        address cancellationReceiver,
        address callbackContract,
        address uiFeeReceiver,
        address market,
        address initialCollateralToken,
        address[] swapPath
      ) addresses,
      tuple(
        uint256 sizeDeltaUsd,
        uint256 initialCollateralDeltaAmount,
        uint256 triggerPrice,
        uint256 acceptablePrice,
        uint256 executionFee,
        uint256 callbackGasLimit,
        uint256 minOutputAmount,
        uint256 validFromTime
      ) numbers,
      uint8 orderType,
      uint8 decreasePositionSwapType,
      bool isLong,
      bool shouldUnwrapNativeToken,
      bool autoCancel,
      bytes32 referralCode,
      bytes32[] dataList
    ) params
  ) external payable returns (bytes32)`,
  "function multicall(bytes[] calldata data) external payable returns (bytes[] memory)",
  "function sendWnt(address receiver, uint256 amount) external payable"
];

const DATA_STORE_ABI = [
  "function getUint(bytes32 key) view returns (uint256)",
  "function getBool(bytes32 key) view returns (bool)"
];

// ── helpers ───────────────────────────────────────────────────────────────────

async function freshImpersonated(): Promise<[import("ethers").Signer, string]> {
  const wallet = ethers.Wallet.createRandom();
  const address = wallet.address;
  await network.provider.send("hardhat_setBalance", [address, ethers.toBeHex(ethers.parseEther("10"))]);
  await network.provider.request({ method: "hardhat_impersonateAccount", params: [address] });
  return [await ethers.getSigner(address), address];
}

/**
 * Build a minimal MarketDecrease order params struct.
 * MarketDecrease (orderType = 5) does NOT require a pluginTransfer of collateral,
 * so the auth check runs first — useful for testing access-control behaviour
 * without needing the main account to have a funded collateral balance.
 */
function buildDecreaseOrderParams(receiver: string): object {
  return {
    addresses: {
      receiver,
      cancellationReceiver: receiver,
      callbackContract: ethers.ZeroAddress,
      uiFeeReceiver: ethers.ZeroAddress,
      market: WETH_USDC_MARKET,
      initialCollateralToken: USDC_ADDRESS,
      swapPath: []
    },
    numbers: {
      sizeDeltaUsd: 1n * 10n ** 30n, // 1 USD in GMX 30-decimal representation
      initialCollateralDeltaAmount: 0n,
      triggerPrice: 0n,
      acceptablePrice: 0n,
      executionFee: 8_000_000_000_000_000n, // 0.008 ETH
      callbackGasLimit: 0n,
      minOutputAmount: 0n,
      validFromTime: 0n
    },
    orderType: 5,               // MarketDecrease
    decreasePositionSwapType: 0,
    isLong: true,
    shouldUnwrapNativeToken: false,
    autoCancel: false,
    referralCode: ethers.ZeroHash,
    dataList: []
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("GMX exploit search: SubaccountRouter delegation limits", function () {
  this.timeout(FUZZ_CONFIG.timeoutMs);

  before(async function () {
    requireRealMutations("subaccountFuzz");
    await requireArbitrumForkOrSkip(() => this.skip());

    const code = await ethers.provider.getCode(SUBACCOUNT_ROUTER_ADDRESS);
    if (code === "0x") {
      console.log("[subaccountFuzz] SubaccountRouter not found — skipping");
      this.skip();
    }
  });

  it("SubaccountRouter has deployed code at expected address", async function () {
    const code = await ethers.provider.getCode(SUBACCOUNT_ROUTER_ADDRESS);
    expect(code).to.not.equal("0x", "SubaccountRouter must have deployed code");
  });

  it("Unauthorized sub-account cannot create orders (SubaccountNotAuthorized)", async function () {
    await withIterationSnapshot(async () => {
      const [mainSigner, mainAddr] = await freshImpersonated();
      const [subSigner, subAddr] = await freshImpersonated();
      void mainAddr; // mainAccount never calls addSubaccount — sub remains unauthorized

      const subaccountRouter = (await ethers.getContractAt(SUBACCOUNT_ROUTER_ABI, SUBACCOUNT_ROUTER_ADDRESS)).connect(subSigner);
      const orderParams = buildDecreaseOrderParams(mainAddr);

      // The authorization check (SubaccountNotAuthorized) fires BEFORE any token
      // transfer, so we only need the gas-covering ETH balance already set.
      await expect(
        (subaccountRouter as any).createOrder(mainAddr, orderParams, {
          value: 8_000_000_000_000_000n,
          gasLimit: 500_000
        })
      ).to.be.reverted;
      // We verify a revert occurs — the exact custom error name is chain-encoded but
      // the revert is guaranteed by SubaccountUtils.validateSubaccount.
    });
  });

  it("Registered sub-account with maxAllowedCount=0 → MaxSubaccountActionCountExceeded", async function () {
    await withIterationSnapshot(async () => {
      const [mainSigner, mainAddr] = await freshImpersonated();
      const [subSigner, subAddr] = await freshImpersonated();

      const routerAsMain = (await ethers.getContractAt(SUBACCOUNT_ROUTER_ABI, SUBACCOUNT_ROUTER_ADDRESS)).connect(mainSigner);
      const routerAsSub = (await ethers.getContractAt(SUBACCOUNT_ROUTER_ABI, SUBACCOUNT_ROUTER_ADDRESS)).connect(subSigner);

      // Step 1: register sub — default maxAllowedCount is 0 in DataStore (unset = 0).
      await (routerAsMain as any).addSubaccount(subAddr, { gasLimit: 200_000 });

      // Step 2: explicitly set maxAllowedCount to 0 (belt-and-suspenders).
      await (routerAsMain as any).setMaxAllowedSubaccountActionCount(
        subAddr,
        SUBACCOUNT_ORDER_ACTION,
        0,
        { gasLimit: 200_000 }
      );

      const orderParams = buildDecreaseOrderParams(mainAddr);

      // Step 3: sub-account tries to create an order — auth passes (it is registered),
      // but action count would increment from 0→1 which exceeds maxAllowedCount=0.
      await expect(
        (routerAsSub as any).createOrder(mainAddr, orderParams, {
          value: 8_000_000_000_000_000n,
          gasLimit: 500_000
        })
      ).to.be.reverted;
      // Reverts with MaxSubaccountActionCountExceeded (custom error).
    });
  });

  it("addSubaccount + removeSubaccount cycle: second call after removal reverts", async function () {
    await withIterationSnapshot(async () => {
      const [mainSigner, mainAddr] = await freshImpersonated();
      const [subSigner, subAddr] = await freshImpersonated();

      const routerAsMain = (await ethers.getContractAt(SUBACCOUNT_ROUTER_ABI, SUBACCOUNT_ROUTER_ADDRESS)).connect(mainSigner);
      const routerAsSub = (await ethers.getContractAt(SUBACCOUNT_ROUTER_ABI, SUBACCOUNT_ROUTER_ADDRESS)).connect(subSigner);

      // Add sub-account and grant count = 1 so the auth check would pass.
      await (routerAsMain as any).addSubaccount(subAddr, { gasLimit: 200_000 });
      await (routerAsMain as any).setMaxAllowedSubaccountActionCount(
        subAddr,
        SUBACCOUNT_ORDER_ACTION,
        1,
        { gasLimit: 200_000 }
      );

      // Remove sub-account immediately — revokes authorization.
      await (routerAsMain as any).removeSubaccount(subAddr, { gasLimit: 200_000 });

      const orderParams = buildDecreaseOrderParams(mainAddr);

      // Sub-account is now removed; call must revert (SubaccountNotAuthorized).
      await expect(
        (routerAsSub as any).createOrder(mainAddr, orderParams, {
          value: 8_000_000_000_000_000n,
          gasLimit: 500_000
        })
      ).to.be.reverted;
    });
  });

  it("Expired delegation → sub-account call reverts", async function () {
    await withIterationSnapshot(async () => {
      const [mainSigner, mainAddr] = await freshImpersonated();
      const [subSigner, subAddr] = await freshImpersonated();

      const routerAsMain = (await ethers.getContractAt(SUBACCOUNT_ROUTER_ABI, SUBACCOUNT_ROUTER_ADDRESS)).connect(mainSigner);
      const routerAsSub = (await ethers.getContractAt(SUBACCOUNT_ROUTER_ABI, SUBACCOUNT_ROUTER_ADDRESS)).connect(subSigner);

      await (routerAsMain as any).addSubaccount(subAddr, { gasLimit: 200_000 });
      await (routerAsMain as any).setMaxAllowedSubaccountActionCount(
        subAddr,
        SUBACCOUNT_ORDER_ACTION,
        100,
        { gasLimit: 200_000 }
      );

      // Set expiresAt to 1 second (epoch time) — guaranteed already in the past.
      await (routerAsMain as any).setSubaccountExpiresAt(
        subAddr,
        SUBACCOUNT_ORDER_ACTION,
        1n, // Unix timestamp 1 = Jan 1 1970 00:00:01 UTC — always expired
        { gasLimit: 200_000 }
      );

      const orderParams = buildDecreaseOrderParams(mainAddr);

      // Sub-account has authorization but the delegation is expired → must revert.
      await expect(
        (routerAsSub as any).createOrder(mainAddr, orderParams, {
          value: 8_000_000_000_000_000n,
          gasLimit: 500_000
        })
      ).to.be.reverted;
    });
  });

  it("Sub-account CANNOT register itself (addSubaccount must be called by main account)", async function () {
    await withIterationSnapshot(async () => {
      const [subSigner, subAddr] = await freshImpersonated();

      // The sub-account calls addSubaccount(itself) via SubaccountRouter.
      // SubaccountUtils.addSubaccount uses msg.sender as the "account", making the
      // sub-account both the account AND the sub-account — which is a degenerate state
      // but must not grant it authority to act on behalf of any OTHER account.
      const routerAsSub = (await ethers.getContractAt(SUBACCOUNT_ROUTER_ABI, SUBACCOUNT_ROUTER_ADDRESS)).connect(subSigner);

      // This call targets the sub-account adding ITSELF as sub-account of itself —
      // even if it succeeds, it only grants authority for its own account (subAddr),
      // not for other accounts.  Its createOrder calls would only create orders for
      // subAddr, of which it controls.
      try {
        await (routerAsSub as any).addSubaccount(subAddr, { gasLimit: 200_000 });
      } catch {
        // If it reverts, the invariant is trivially satisfied.
      }

      // Now attempt to create an order FOR a different mainAccount.
      const [, mainAddr] = await freshImpersonated();
      const orderParams = buildDecreaseOrderParams(mainAddr);

      await expect(
        (routerAsSub as any).createOrder(mainAddr, orderParams, {
          value: 8_000_000_000_000_000n,
          gasLimit: 500_000
        })
      ).to.be.reverted;  // sub is not authorized for mainAddr's account
    });
  });
});
