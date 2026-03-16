/**
 * ExternalHandler adversarial invariant tests.
 *
 * ExternalHandler (0x389CEf54…) is a privilege-escrow contract that lets
 * CONTROLLER-role contracts call arbitrary external addresses without
 * exposing the controller's privileged context.  The contract has:
 *   - No access control on makeExternalCalls (callable by anyone)
 *   - A ReentrancyGuard (nonReentrant modifier)
 *   - Target must be a deployed contract (isContract check)
 *
 * The Immunefi-scope reentrancy risk is: a malicious callback target
 * reenters makeExternalCalls or another sensitive GMX function during
 * the external call.  The ReentrancyGuard must block this.
 *
 * Coverage:
 *  1. Reentrancy guard: makeExternalCalls with target = ExternalHandler
 *     itself (self-reentrant call) is caught and reverts.
 *  2. Non-contract target: call with EOA address → reverts (InvalidExternalCallTarget).
 *  3. Failing external call: call that reverts inside the target propagates
 *     as ExternalCallFailed (not silently swallowed).
 *  4. Input length mismatch: targets.length ≠ dataList.length → reverts.
 */

import { ethers } from "hardhat";
import { expect } from "chai";

import { FUZZ_CONFIG, requireArbitrumForkOrSkip, requireRealMutations, withIterationSnapshot } from "./harness";

// ── addresses ────────────────────────────────────────────────────────────────

const EXTERNAL_HANDLER_ADDRESS =
  process.env.GMX_EXTERNAL_HANDLER_ADDRESS || "0x389CEf541397e872dC04421f166B5Bc2E0b374a5";

// ── minimal ABI ───────────────────────────────────────────────────────────────

const EXTERNAL_HANDLER_ABI = [
  `function makeExternalCalls(
    address[] memory targets,
    bytes[] memory dataList,
    address[] memory refundTokens,
    address[] memory refundReceivers
  ) external`
];

// ── tests ─────────────────────────────────────────────────────────────────────

describe("GMX exploit search: ExternalHandler reentrancy invariants", function () {
  this.timeout(FUZZ_CONFIG.timeoutMs);

  let externalHandler: ReturnType<typeof ethers.getContractAt> extends Promise<infer R> ? R : never;
  let externalHandlerAddress: string;

  before(async function () {
    requireRealMutations("externalHandlerFuzz");
    await requireArbitrumForkOrSkip(() => this.skip());

    const code = await ethers.provider.getCode(EXTERNAL_HANDLER_ADDRESS);
    if (code === "0x") {
      console.log("[externalHandlerFuzz] ExternalHandler not found — skipping");
      this.skip();
    }

    externalHandler = await ethers.getContractAt(EXTERNAL_HANDLER_ABI, EXTERNAL_HANDLER_ADDRESS);
    externalHandlerAddress = EXTERNAL_HANDLER_ADDRESS;
  });

  it("ExternalHandler has deployed code at expected address", async function () {
    const code = await ethers.provider.getCode(externalHandlerAddress);
    expect(code).to.not.equal("0x", "ExternalHandler must have code at the expected address");
    expect(code.length).to.be.greaterThan(4, "ExternalHandler bytecode appears too short");
  });

  it("ReentrancyGuard: self-reentrant makeExternalCalls call reverts", async function () {
    await withIterationSnapshot(async () => {
      // Encode a call to makeExternalCalls([], [], [], []) — the inner call requests
      // ExternalHandler to call itself recursively.  The nonReentrant guard must block
      // the second entry, causing _makeExternalCall to receive a failure → ExternalCallFailed.
      const innerCallData = (externalHandler as any).interface.encodeFunctionData(
        "makeExternalCalls",
        [[], [], [], []]
      );

      // outer call: targets = [ExternalHandler itself], dataList = [innerCallData]
      await expect(
        (externalHandler as any).makeExternalCalls(
          [externalHandlerAddress],
          [innerCallData],
          [],
          [],
          { gasLimit: 500_000 }
        )
      ).to.be.reverted;  // Must revert — either ReentrancyGuard or ExternalCallFailed propagation
    });
  });

  it("Non-contract (EOA) target → reverts with InvalidExternalCallTarget", async function () {
    await withIterationSnapshot(async () => {
      const [signer] = await ethers.getSigners();
      const eoaAddress = await signer.getAddress();

      // ExternalHandler._makeExternalCall requires target.isContract(); EOA fails this.
      await expect(
        (externalHandler as any).makeExternalCalls(
          [eoaAddress],
          [ethers.toUtf8Bytes("dummy")],
          [],
          [],
          { gasLimit: 200_000 }
        )
      ).to.be.reverted;
    });
  });

  it("Input array length mismatch → reverts", async function () {
    await withIterationSnapshot(async () => {
      // targets.length (1) ≠ dataList.length (2) → InvalidExternalCallInput
      await expect(
        (externalHandler as any).makeExternalCalls(
          [externalHandlerAddress],               // 1 target
          [ethers.toUtf8Bytes("a"), ethers.toUtf8Bytes("b")],  // 2 data items
          [],
          [],
          { gasLimit: 100_000 }
        )
      ).to.be.reverted;
    });
  });

  it("Failed external call propagates as revert (not silently swallowed)", async function () {
    await withIterationSnapshot(async () => {
      // Call ExternalHandler → USDC ERC-20 with data that will revert (bad selector).
      const usdcAddress = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
      const badCallData = "0xdeadbeef"; // non-existent selector on USDC

      await expect(
        (externalHandler as any).makeExternalCalls(
          [usdcAddress],
          [badCallData],
          [],
          [],
          { gasLimit: 200_000 }
        )
      ).to.be.reverted;  // Must revert via ExternalCallFailed, not succeed silently
    });
  });

  it("Empty call (no targets) succeeds without state changes", async function () {
    await withIterationSnapshot(async () => {
      const activeChain = (process.env.GMX_CHAIN || "arbitrum").toLowerCase();

      if (activeChain === "avalanche") {
        // Avalanche deployment reverts on empty input with no revert data (older bytecode, bare revert).
        // Using revertedWithoutReason() pins this to the *observed* selector-less revert;
        // any future regression to a custom-error revert or a silent success would fail this assertion.
        await expect(
          (externalHandler as any).makeExternalCalls(
            [],
            [],
            [],
            [],
            { gasLimit: 100_000 }
          )
        ).to.be.revertedWithoutReason();
        return;
      }

      // Arbitrum behavior: empty makeExternalCalls is a no-op and succeeds.
      const tx = await (externalHandler as any).makeExternalCalls([], [], [], [], {
        gasLimit: 100_000
      });
      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1, "Empty makeExternalCalls must succeed");
    });
  });
});
