#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const { globSync } = require("glob");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function compileValidator(schemaPath, ajv) {
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found: ${schemaPath}`);
  }
  const schema = readJson(schemaPath);
  return ajv.compile(schema);
}

function validateOneFile(filePath, validate, label) {
  const payload = readJson(filePath);
  const valid = validate(payload);
  if (!valid) {
    console.error(`FAIL: ${label} -> ${filePath}`);
    for (const err of validate.errors || []) {
      console.error(`  ${err.instancePath || "/"} ${err.message}`);
    }
    return false;
  }

  console.log(`OK:   ${label} -> ${filePath}`);
  return true;
}

function parseArgs(argv) {
  const args = {
    triagePath: "outputs/triage/triage-result.json",
    proofSummaryPattern: "proof-packages/**/summary.json"
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    if (current === "--triage" && next) {
      args.triagePath = next;
      i += 1;
    } else if (current === "--proof-summaries" && next) {
      args.proofSummaryPattern = next;
      i += 1;
    }
  }

  return args;
}

function main() {
  const { triagePath, proofSummaryPattern } = parseArgs(process.argv.slice(2));

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const triageSchemaPath = path.resolve(__dirname, "..", "schemas", "triage-result.schema.v1.json");
  const proofSchemaPath = path.resolve(__dirname, "..", "schemas", "proof-package.schema.v1.json");

  const validateTriage = compileValidator(triageSchemaPath, ajv);
  const validateProofSummary = compileValidator(proofSchemaPath, ajv);

  let failed = 0;

  const triageFullPath = path.resolve(process.cwd(), triagePath);
  if (!fs.existsSync(triageFullPath)) {
    console.error(`FAIL: triage file not found -> ${triagePath}`);
    failed += 1;
  } else if (!validateOneFile(triageFullPath, validateTriage, "triage-result")) {
    failed += 1;
  }

  const summaryFiles = globSync(proofSummaryPattern, {
    cwd: process.cwd(),
    windowsPathsNoEscape: true,
    nodir: true
  });

  if (summaryFiles.length === 0) {
    console.log(`INFO: no proof summaries found for pattern ${proofSummaryPattern}`);
  }

  for (const relativePath of summaryFiles) {
    const fullPath = path.resolve(process.cwd(), relativePath);
    if (!validateOneFile(fullPath, validateProofSummary, "proof-package-summary")) {
      failed += 1;
    }
  }

  if (failed > 0) {
    console.error(`\nSchema validation failed (${failed} file(s)).`);
    process.exit(1);
  }

  console.log("\nSchema validation passed.");
}

main();
