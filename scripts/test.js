import { ethers } from "ethers";

async function main() {

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");

const block = await provider.getBlockNumber();

console.log("Current block:", block);

}

main();