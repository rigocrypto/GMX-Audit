const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function run() {
  const repoRoot = process.cwd();
  const packageJsonPath = path.join(repoRoot, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    console.error("package.json not found in current working directory");
    process.exit(1);
  }

  const originalPackageJsonText = fs.readFileSync(packageJsonPath, "utf8");
  let packageJson;

  try {
    packageJson = JSON.parse(originalPackageJsonText);
  } catch (error) {
    console.error("Failed to parse package.json:", error);
    process.exit(1);
  }

  const hadType = Object.prototype.hasOwnProperty.call(packageJson, "type");
  const previousType = packageJson.type;
  const needsEsmToggle = packageJson.type !== "module";

  try {
    if (needsEsmToggle) {
      packageJson.type = "module";
      fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
    }

    const hardhatIndex = require.resolve("hardhat");
    const hardhatCli = path.join(path.dirname(hardhatIndex), "cli.js");
    const hardhatArgs = process.argv.slice(2);

    if (!fs.existsSync(hardhatCli)) {
      console.error(`Hardhat CLI not found at ${hardhatCli}`);
      process.exit(1);
    }

    const result = spawnSync(process.execPath, [hardhatCli, ...hardhatArgs], {
      stdio: "inherit",
      env: process.env,
      shell: false,
    });

    if (result.error) {
      console.error(result.error);
      process.exit(1);
    }

    process.exit(result.status ?? 1);
  } finally {
    try {
      if (needsEsmToggle) {
        if (hadType) {
          packageJson.type = previousType;
          fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
        } else {
          fs.writeFileSync(packageJsonPath, originalPackageJsonText, "utf8");
        }
      }
    } catch (restoreError) {
      console.error("Failed to restore package.json after Hardhat run:", restoreError);
    }
  }
}

run();
