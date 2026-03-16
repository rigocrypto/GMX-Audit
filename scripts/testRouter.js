const { ethers } = require("hardhat");

async function main() {

  const routerAddress = "0x..."; // ExchangeRouter

  const router = await ethers.getContractAt(
    "ExchangeRouter",
    routerAddress
  );

  console.log("Router loaded:", router.address);

}

main();