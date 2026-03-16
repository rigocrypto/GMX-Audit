const { spawnSync } = require("child_process");

function parseArgs(argv) {
  const args = argv.slice(2);
  let vaultAddress = process.env.GMX_VAULT_ADDRESS;
  let csvPath = process.env.GMX_VAULT_CSV_PATH;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!vaultAddress && !arg.startsWith("--")) {
      vaultAddress = arg;
      continue;
    }

    if (arg === "--csv") {
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("--")) {
        csvPath = nextArg;
        i++;
      } else if (!csvPath) {
        csvPath = "whitelisted-tokens.csv";
      }
      continue;
    }

    if (arg.startsWith("--csv=")) {
      const value = arg.slice("--csv=".length).trim();
      csvPath = value || "whitelisted-tokens.csv";
    }
  }

  return { vaultAddress, csvPath };
}

function main() {
  const { vaultAddress, csvPath } = parseArgs(process.argv);
  const env = { ...process.env };

  if (vaultAddress) {
    env.GMX_VAULT_ADDRESS = vaultAddress;
  }

  if (csvPath) {
    env.GMX_VAULT_CSV_PATH = csvPath;
  }

  const result = spawnSync(
    "npx",
    ["hardhat", "run", "scripts/gmxVault.js", "--network", "hardhat"],
    {
      env,
      stdio: "inherit",
      shell: true,
    }
  );

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

main();
