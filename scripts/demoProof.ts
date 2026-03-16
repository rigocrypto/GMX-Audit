import fs from "fs";
import path from "path";
import { execSync } from "child_process";

type CliArgs = {
  priceUsd: string;
  proofDir: string;
  outDir: string;
};

function parseArgs(argv: string[]): CliArgs {
  const pIdx = argv.indexOf("--price");
  const proofDirIdx = argv.indexOf("--proofDir");
  const outDirIdx = argv.indexOf("--outDir");
  const priceUsd = pIdx !== -1 && argv[pIdx + 1] ? argv[pIdx + 1] : "2172.24";
  const proofDir =
    proofDirIdx !== -1 && argv[proofDirIdx + 1]
      ? argv[proofDirIdx + 1]
      : "outputs/demo/proofs";
  const outDir =
    outDirIdx !== -1 && argv[outDirIdx + 1]
      ? argv[outDirIdx + 1]
      : "outputs/demo/proof-packages";
  return { priceUsd, proofDir, outDir };
}

function ensureNumeric(text: string): void {
  if (!/^\d+(?:\.\d+)?$/.test(text)) {
    throw new Error(`Invalid --price value: ${text}`);
  }
}

function main(): void {
  const { priceUsd, proofDir: proofDirArg, outDir: outDirArg } = parseArgs(process.argv.slice(2));
  ensureNumeric(priceUsd);

  const proofDir = path.resolve(process.cwd(), proofDirArg);
  const proofPath = path.join(proofDir, "demo-proof.json");
  const outDir = path.resolve(process.cwd(), outDirArg);

  fs.mkdirSync(proofDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const demoProof = {
    chain: "arbitrum",
    block: 420000000,
    detector: "DemoInvariantReplay",
    description: "Deterministic demo proof used for OSS onboarding and report generation checks.",
    userNet: "8500000000000000000",
    poolNet: "-8500000000000000000",
    txs: [
      {
        hash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        to: "0x0000000000000000000000000000000000000001",
        desc: "demo replay transaction"
      }
    ],
    env: {
      GMX_CHAIN: "arbitrum",
      FORK_BLOCK: "420000000"
    },
    repro: {
      command: "npm run test:gmx-exploit-search:extended",
      notes: "Demonstration fixture only. Not a live exploit finding."
    }
  };

  fs.writeFileSync(proofPath, `${JSON.stringify(demoProof, null, 2)}\n`, "utf8");

  execSync(`npm run proof:package -- --file "${proofPath}" --outDir "${outDir}" --price ${priceUsd}`, {
    stdio: "inherit"
  });

  console.log(`Demo proof written: ${proofPath}`);
  console.log(`Package output root: ${outDir}`);
  console.log("Note: demo artifacts are isolated from exploit-proofs and production proof-packages by default.");
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(2);
  }
}
