#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const schemaPath = path.resolve("schemas", "engagement.manifest.schema.json");
const latestPointerPath = path.resolve("outputs", "bundles", "LATEST.json");

if (!fs.existsSync(schemaPath)) {
  console.error(`Schema file not found: ${schemaPath}`);
  process.exit(1);
}

if (!fs.existsSync(latestPointerPath)) {
  console.error(`LATEST bundle pointer not found: ${latestPointerPath}`);
  process.exit(1);
}

const schema = readJson(schemaPath);
const validate = ajv.compile(schema);
const latestPointer = readJson(latestPointerPath);
const manifestPath = path.join(latestPointer.absolutePath, "engagement.manifest.json");

if (!fs.existsSync(manifestPath)) {
  console.error(`Manifest not found: ${manifestPath}`);
  process.exit(1);
}

const manifest = readJson(manifestPath);
const valid = validate(manifest);

if (!valid) {
  console.error("Schema round-trip FAILED:");
  for (const error of validate.errors || []) {
    const instancePath = error.instancePath || "/";
    console.error(`  ${instancePath} ${error.message}`);
  }
  process.exit(1);
}

console.log(`Schema round-trip OK (schemaVersion: ${manifest.schemaVersion})`);