import { ethers } from "hardhat";

const EXCHANGE_ROUTER_ABI = [
  "function router() view returns (address)"
];

const ROUTER_ABI = [
  "function pluginTransfer(address token, address account, address receiver, uint256 amount) external"
];

const ROLE_STORE_ABI = [
  "function hasRole(address account, bytes32 roleKey) view returns (bool)",
  "function getRoleMemberCount(bytes32 roleKey) view returns (uint256)",
  "function getRoleMembers(bytes32 roleKey, uint256 start, uint256 end) view returns (address[])"
];

const LAYER_ZERO_PROVIDER_ABI = [
  "function bridgeOut(address account, uint256 srcChainId, (address provider,address token,uint256 amount,uint256 minAmountOut,bytes data) params) external returns (uint256)"
];

function envOrThrow(name: string): string {
  const value = (process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function main() {
  const exchangeRouterAddress = envOrThrow("GMX_EXCHANGE_ROUTER_ADDRESS");
  const roleStoreAddress = envOrThrow("GMX_ROLE_STORE_ADDRESS");
  const layerZeroProviderAddress = (process.env.GMX_LAYERZERO_PROVIDER_ADDRESS || "").trim();

  const [probeSigner] = await ethers.getSigners();
  const probeAddress = await probeSigner.getAddress();

  const exchangeRouter = await ethers.getContractAt(EXCHANGE_ROUTER_ABI, exchangeRouterAddress);
  const routerAddress = await (exchangeRouter as any).router();
  const router = await ethers.getContractAt(ROUTER_ABI, routerAddress, probeSigner);

  const roleStore = await ethers.getContractAt(ROLE_STORE_ABI, roleStoreAddress);
  const routerPluginRoleKey = ethers.keccak256(ethers.toUtf8Bytes("ROUTER_PLUGIN"));
  const controllerRoleKey = ethers.keccak256(ethers.toUtf8Bytes("CONTROLLER"));

  const signerIsRouterPlugin = await (roleStore as any).hasRole(probeAddress, routerPluginRoleKey);
  const signerIsController = await (roleStore as any).hasRole(probeAddress, controllerRoleKey);

  const routerPluginCount = await (roleStore as any).getRoleMemberCount(routerPluginRoleKey);
  const routerPluginMembers = await (roleStore as any).getRoleMembers(
    routerPluginRoleKey,
    0,
    routerPluginCount > 5n ? 5n : routerPluginCount
  );

  let pluginTransferBlocked = false;
  let pluginTransferError = "";

  try {
    const tx = await (router as any).pluginTransfer(
      "0x0000000000000000000000000000000000000001",
      probeAddress,
      probeAddress,
      1n
    );
    await tx.wait();
  } catch (error) {
    pluginTransferBlocked = true;
    pluginTransferError = error instanceof Error ? error.message : String(error);
  }

  let bridgeOutBlocked = false;
  let bridgeOutError = "skipped-no-address";

  if (layerZeroProviderAddress) {
    const lzProvider = await ethers.getContractAt(LAYER_ZERO_PROVIDER_ABI, layerZeroProviderAddress, probeSigner);
    try {
      const tx = await (lzProvider as any).bridgeOut(
        probeAddress,
        0n,
        {
          provider: ethers.ZeroAddress,
          token: ethers.ZeroAddress,
          amount: 0n,
          minAmountOut: 0n,
          data: "0x"
        }
      );
      await tx.wait();
      bridgeOutError = "unexpected-success";
    } catch (error) {
      bridgeOutBlocked = true;
      bridgeOutError = error instanceof Error ? error.message : String(error);
    }
  }

  const result = {
    chainHint: process.env.GMX_CHAIN || "arbitrum",
    probeAddress,
    exchangeRouterAddress,
    routerAddress,
    roleStoreAddress,
    signerIsRouterPlugin,
    signerIsController,
    routerPluginRoleKey,
    controllerRoleKey,
    routerPluginCount: routerPluginCount.toString(),
    routerPluginMembers,
    pluginTransferBlocked,
    pluginTransferError,
    layerZeroProviderAddress: layerZeroProviderAddress || null,
    bridgeOutBlocked,
    bridgeOutError
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
