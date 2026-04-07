#!/usr/bin/env ts-node
/// <reference types="node" />
/**
 * generate-repro.ts
 *
 * Parses a failing forge invariant run from stdin and emits test/repro.t.sol.
 *
 * Usage:
 *   npm run test:moonwell:handler 2>&1 | ts-node scripts/generate-repro.ts
 *
 * Or with a known seed:
 *   REPRO_SEED=0xdeadbeef npm run test:moonwell:handler 2>&1 | ts-node scripts/generate-repro.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

interface CallRecord {
  fn: string;
  args: string;
}

async function parseForgeOutput(): Promise<{
  invariant: string;
  seed: string;
  sequence: CallRecord[];
  rawOutput: string;
}> {
  const startedAt = Date.now();
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const lines: string[] = [];

  for await (const line of rl) {
    lines.push(line);
  }

  const elapsedMs = Date.now() - startedAt;
  console.error(`[repro-gen] Forge output stream closed after ${Math.round(elapsedMs / 1000)}s.`);

  const raw = lines.join("\n");

  const invMatch = raw.match(/invariant_(\w+)/);
  const invariant = invMatch ? `invariant_${invMatch[1]}` : "invariant_unknown";

  const seedMatch = raw.match(/Failing seed:\s*(0x[0-9a-fA-F]+)/);
  const seed = seedMatch ? seedMatch[1] : (process.env.REPRO_SEED ?? "0x0");

  const callRegex = /\[\d+\]\s+\w+\.(\w+)\(([^)]*)\)/g;
  const sequence: CallRecord[] = [];
  let match: RegExpExecArray | null;

  while ((match = callRegex.exec(raw)) !== null) {
    sequence.push({ fn: match[1], args: match[2].trim() });
  }

  return { invariant, seed, sequence, rawOutput: raw };
}

function splitArgs(args: string): string[] {
  if (!args.trim()) return [];
  return args.split(",").map((s) => s.trim());
}

function renderCall(call: CallRecord, idx: number): string {
  const { fn, args } = call;

  const translations: Record<string, (a: string) => string> = {
    supply: (a) => {
      const [u, m, amt] = splitArgs(a);
      return `// Step ${idx + 1}: supply\n        handler.supply(${u}, ${m}, ${amt});`;
    },
    borrow: (a) => {
      const [u, m, amt] = splitArgs(a);
      return `// Step ${idx + 1}: borrow\n        handler.borrow(${u}, ${m}, ${amt});`;
    },
    redeem: (a) => {
      const [u, m, tokens] = splitArgs(a);
      return `// Step ${idx + 1}: redeem\n        handler.redeem(${u}, ${m}, ${tokens});`;
    },
    repay: (a) => {
      const [u, m] = splitArgs(a);
      return `// Step ${idx + 1}: repay\n        handler.repay(${u}, ${m});`;
    },
    accrueInterest: (a) => {
      const [m] = splitArgs(a);
      return `// Step ${idx + 1}: accrueInterest\n        handler.accrueInterest(${m});`;
    },
    mineBlocks: (a) => {
      const [n] = splitArgs(a);
      return `// Step ${idx + 1}: mine ${n} blocks\n        handler.mineBlocks(${n});`;
    },
    liquidate: (a) => {
      const parts = splitArgs(a);
      return `// Step ${idx + 1}: liquidate\n        handler.liquidate(${parts.join(", ")});`;
    },
    exitMarketWhileBorrowing: (a) => {
      const [u, m] = splitArgs(a);
      return `// Step ${idx + 1}: exit market while borrowing\n        handler.exitMarketWhileBorrowing(${u}, ${m});`;
    },
    sameBlockAttack: (a) => {
      const parts = splitArgs(a);
      return `// Step ${idx + 1}: same-block attack\n        handler.sameBlockAttack(${parts.join(", ")});`;
    }
  };

  const renderer = translations[fn];
  if (renderer) return renderer(args);
  return `// Step ${idx + 1}: ${fn}(${args})\n        handler.${fn}(${args});`;
}

function generateReproScript(
  invariant: string,
  seed: string,
  sequence: CallRecord[],
  rawOutput: string
): string {
  const steps = sequence.map((c, i) => `        ${renderCall(c, i)}`).join("\n\n");
  const timestamp = new Date().toISOString();

  return `// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

/**
 * AUTO-GENERATED REPRO SCRIPT
 * Generated: ${timestamp}
 * Failing invariant: ${invariant}
 * Forge seed: ${seed}
 *
 * HOW TO RUN:
 *   forge test --match-test test_repro --fork-url $BASE_RPC_URL -vvvv
 */

import "forge-std/Test.sol";
import "./moonwell/MoonwellHandler.t.sol";

contract MoonwellRepro is Test {
    MoonwellHandler public handler;

    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_RPC_URL"), 18_500_000);
        handler = new MoonwellHandler();
    }

    function test_repro() public {
        // Failing call sequence (${sequence.length} steps)
        // Seed: ${seed}

${steps || "        // No sequence captured. Re-run with -vv or higher."}

        handler.${invariant}();
    }
}

/**
 * RAW FORGE OUTPUT:
 *
${rawOutput.split("\n").map((l) => ` * ${l}`).join("\n")}
 */
`;
}

async function main() {
  console.error("[repro-gen] Reading forge output from stdin (waiting for forge test to finish)...");

  const { invariant, seed, sequence, rawOutput } = await parseForgeOutput();

  if (sequence.length === 0) {
    console.error("[repro-gen] WARNING: no call sequence found. Run forge with -vv or higher.");
  }

  const script = generateReproScript(invariant, seed, sequence, rawOutput);

  const outDir = path.join(process.cwd(), "test");
  const outFile = path.join(outDir, "repro.t.sol");

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, script, "utf8");

  console.log(`\n[repro-gen] Repro script written to: ${outFile}`);
  console.log(`[repro-gen] Invariant: ${invariant}`);
  console.log(`[repro-gen] Seed:      ${seed}`);
  console.log(`[repro-gen] Steps:     ${sequence.length}`);
  console.log("\n[repro-gen] To run:");
  console.log("  forge test --match-test test_repro --fork-url $BASE_RPC_URL -vvvv");
}

main().catch((err) => {
  console.error("[repro-gen] FATAL:", err);
  process.exit(1);
});
