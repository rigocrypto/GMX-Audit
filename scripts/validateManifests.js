#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const { globSync } = require("glob");

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const schemaPath = path.resolve(__dirname, "..", "schemas", "engagement.manifest.schema.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const validate = ajv.compile(schema);

const pattern = process.argv[2] || "outputs/bundles/*/engagement.manifest.json";
const files = globSync(pattern, { cwd: process.cwd(), windowsPathsNoEscape: true });

if (files.length === 0) {
  console.error(`No manifests found matching: ${pattern}`);
  process.exit(1);
}

let failed = 0;
for (const relativePath of files) {
  const fullPath = path.resolve(process.cwd(), relativePath);
  const manifest = JSON.parse(fs.readFileSync(fullPath, "utf8"));
  const valid = validate(manifest);
  if (!valid) {
    console.error(`FAIL: ${relativePath}`);
    for (const err of validate.errors || []) {
      console.error(`  ${err.instancePath || "/"} ${err.message}`);
    }
    failed += 1;
  } else {
    console.log(`OK:   ${relativePath}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} manifest(s) failed validation.`);
  process.exit(1);
}

console.log(`\nAll ${files.length} manifest(s) valid.`);
