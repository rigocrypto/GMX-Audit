import { expect } from "chai";
import { ethers } from "hardhat";

import { FUZZ_CONFIG, fundFreshSigner, mineBlocksWithAccrual, requireRealMutations } from "./harness";

const REWARD_ROUTER_V2 = "0xA906F338CB21815cBc4Bc87ace9e68c87eF8d8F1";
const GLP_MANAGER_V2 = "0x3963FfC9dff443c2A94f21b129D429891E32ec18";
const STAKED_GLP = process.env.GMX_GLP_STAKED_GLP || "0x5402B5F40310bDED796c7D0F3FF6683f5C0cFfdf";
const WETH = process.env.GMX_GLP_WETH || "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";

type GlpRouteConfig = {
  label: string;
  router: string;
  manager: string;
};

function getGlpRouteCandidates(): GlpRouteConfig[] {
  const candidates: GlpRouteConfig[] = [{ label: "v2-default", router: REWARD_ROUTER_V2, manager: GLP_MANAGER_V2 }];

  const explicitRouter = process.env.GMX_GLP_REWARD_ROUTER;
  const explicitManager = process.env.GMX_GLP_MANAGER;
  if (explicitRouter && explicitManager) {
    candidates.push({ label: "env-config", router: explicitRouter, manager: explicitManager });
  }

  return candidates;
}

const REWARD_ROUTER_V2_ABI = [
  "function mintAndStakeGlp(address token, uint256 amount, uint256 minUsdg, uint256 minGlp) returns (uint256)",
  "function unstakeAndRedeemGlp(address tokenOut, uint256 glpAmount, uint256 minOut, address receiver) returns (uint256)"
];

const GLP_MANAGER_ABI = ["function gov() view returns (address)"];

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)"
];

const WETH_ABI = [...ERC20_ABI, "function deposit() payable"];

describe("GLP v1 Critical Bounty Coverage", function () {
  this.timeout(FUZZ_CONFIG.timeoutMs);

  before(() => {
    requireRealMutations("glpV1");
  });

  let snapshotId: string;

  beforeEach(async () => {
    snapshotId = await ethers.provider.send("evm_snapshot", []);
  });

  afterEach(async () => {
    await ethers.provider.send("evm_revert", [snapshotId]);
  });

  it("mint -> redeem GLP: user cannot extract net value beyond tolerance", async function () {
    const activeChain = (process.env.GMX_CHAIN || "arbitrum").toLowerCase();
    if (activeChain === "avalanche") {
      this.skip();
      return;
    }

    // Hardhat forked providers can fail static calls at the exact fork boundary block.
    // Move one block forward before querying governance or executing GLP interactions.
    await ethers.provider.send("hardhat_mine", ["0x1"]);

    const signer = await fundFreshSigner(ethers.parseEther("2"));
    const userAddress = await signer.getAddress();
    const depositAmount = ethers.parseEther("0.1");
    const weth = await ethers.getContractAt(WETH_ABI, WETH, signer);

    await (await (weth as any).deposit({ value: depositAmount })).wait();

    const wethBefore = BigInt((await (weth as any).balanceOf(userAddress)).toString());

    let selectedRoute: GlpRouteConfig | undefined;
    const routeFailures: string[] = [];

    for (const route of getGlpRouteCandidates()) {
      if (!ethers.isAddress(route.manager) || !ethers.isAddress(route.router)) {
        routeFailures.push(`${route.label}: invalid address literal`);
        continue;
      }

      const managerCode = await ethers.provider.getCode(route.manager);
      const routerCode = await ethers.provider.getCode(route.router);
      if (managerCode === "0x" || routerCode === "0x") {
        routeFailures.push(`${route.label}: missing code (manager=${managerCode === "0x"}, router=${routerCode === "0x"})`);
        continue;
      }

      const manager = await ethers.getContractAt(GLP_MANAGER_ABI, route.manager);
      await (manager as any).gov();

      await (await (weth as any).approve(route.router, depositAmount)).wait();
      await (await (weth as any).approve(route.manager, depositAmount)).wait();
      const router = await ethers.getContractAt(REWARD_ROUTER_V2_ABI, route.router, signer);

      try {
        await (await (router as any).mintAndStakeGlp(WETH, depositAmount, 0n, 0n)).wait();
        selectedRoute = route;
        break;
      } catch (error) {
        const message = String((error as Error)?.message || error);
        if (message.includes("GlpManager: forbidden")) {
          routeFailures.push(`${route.label}: forbidden`);
          continue;
        }
        routeFailures.push(`${route.label}: ${message.slice(0, 120)}`);
        break;
      }
    }

    if (!selectedRoute) {
      if (process.env.GMX_BOUNTY_MODE === "1") {
        expect.fail(
          "GLP v1 mint route did not execute for available router/manager pairs. " +
            `Failures: ${routeFailures.join("; ") || "none"}. ` +
            "Set GMX_GLP_REWARD_ROUTER and GMX_GLP_MANAGER to a known-good historical pair."
        );
      }
      this.skip();
      return;
    }

    await mineBlocksWithAccrual(920);

    const sglp = await ethers.getContractAt(ERC20_ABI, STAKED_GLP, signer);
    const glpBalance = BigInt((await (sglp as any).balanceOf(userAddress)).toString());
    expect(glpBalance).to.be.gt(0n, "sGLP balance should be positive after mint");

    const activeRouter = await ethers.getContractAt(REWARD_ROUTER_V2_ABI, selectedRoute.router, signer);
    try {
      await (await (activeRouter as any).unstakeAndRedeemGlp(WETH, glpBalance, 0n, userAddress)).wait();
    } catch (error) {
      if (process.env.GMX_BOUNTY_MODE === "1") {
        throw error;
      }
      if (String((error as Error)?.message || error).includes("GlpManager: forbidden")) {
        this.skip();
        return;
      }
      throw error;
    }

    const wethAfter = BigInt((await (weth as any).balanceOf(userAddress)).toString());
    const netDelta = wethAfter - wethBefore;

    // Anti-extraction invariant: user should not realize positive net gain above dust.
    expect(netDelta <= ethers.parseEther("0.001"), `unexpected net extraction: ${netDelta.toString()}`).to.equal(true);
  });
});
