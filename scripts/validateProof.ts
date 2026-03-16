import fs from "fs";
import path from "path";

import Ajv from "ajv";
import addFormats from "ajv-formats";

type Severity = "Critical" | "High" | "Medium";

type ProofLike = {
  userNet: string;
  poolNet: string;
};

function printUsage(): void {
  console.error("Usage: npm run proof:validate -- --file <path-to-proof.json>");
}

function getArgValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

export function computeSeverity(proof: ProofLike): Severity {
  const userNet = BigInt(proof.userNet);
  const poolNet = BigInt(proof.poolNet);

  if (userNet > 0n || poolNet < 0n) return "Critical";
  if (userNet !== 0n || poolNet !== 0n) return "High";
  return "Medium";
}

function failInput(message: string): never {
  console.error(`[proof:validate] ${message}`);
  process.exit(2);
}

function failSchema(message: string): never {
  console.error(`[proof:validate] ${message}`);
  process.exit(3);
}

function main(): void {
  const fileArg = getArgValue("--file");
  if (!fileArg) {
    printUsage();
    failInput("missing required --file argument");
  }

  const filePath = path.resolve(process.cwd(), fileArg);
  if (!fs.existsSync(filePath)) {
    failInput(`file not found: ${filePath}`);
  }

  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    failInput(`cannot read file: ${(error as Error).message}`);
  }

  let proof: unknown;
  try {
    proof = JSON.parse(raw);
  } catch (error) {
    failInput(`invalid JSON: ${(error as Error).message}`);
  }

  const schemaPath = path.resolve(process.cwd(), "schemas", "proof.schema.json");
  if (!fs.existsSync(schemaPath)) {
    failInput(`schema file not found: ${schemaPath}`);
  }

  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const isValid = validate(proof);
  if (!isValid) {
    const errors = (validate.errors || [])
      .map((err) => `${err.instancePath || "/"} ${err.message || "schema error"}`)
      .join("; ");
    failSchema(`schema validation failed: ${errors}`);
  }

  const typed = proof as ProofLike;
  try {
    BigInt(typed.userNet);
    BigInt(typed.poolNet);
  } catch (error) {
    failSchema(`userNet/poolNet must be BigInt-compatible strings: ${(error as Error).message}`);
  }

  const severity = computeSeverity(typed);
  console.log(`[proof:validate] OK`);
  console.log(`[proof:validate] severity=${severity}`);
  process.exit(0);
}

if (require.main === module) {
  main();
}