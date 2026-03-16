import assert from "node:assert/strict";

import { stableProofHash } from "../triage";
import { canonicalJson } from "../utils/canonicalJson";
import { weiToUSD } from "../utils/formatWei";

const hashA = stableProofHash({ chain: "arbitrum", block: 1, detector: "X" });
const hashB = stableProofHash({ detector: "X", block: 1, chain: "arbitrum" });
assert.equal(hashA, hashB, "stable hash should be deterministic");

const nestedA = canonicalJson({ env: { FORK: "1", CHAIN: "arb" } });
const nestedB = canonicalJson({ env: { CHAIN: "arb", FORK: "1" } });
assert.equal(nestedA, nestedB, "canonicalJson should be order-independent for nested objects");

const withNull = canonicalJson({ txs: null });
const withArray = canonicalJson({ txs: [] });
assert.notEqual(withNull, withArray, "null and empty arrays should remain distinct");

const bigString = canonicalJson({ userNet: "99999999999999999999" });
assert.ok(bigString.includes('"99999999999999999999"'), "large wei values must remain strings");

const withUndefined = canonicalJson({ chain: "arb", repro: undefined });
const withMissing = canonicalJson({ chain: "arb" });
assert.equal(withUndefined, withMissing, "undefined fields should not alter canonical form");

const negative = weiToUSD("-8500000000000000001", 3400);
assert.ok(!negative.eth.includes("-."), "negative formatting should not produce malformed decimal");
assert.ok(negative.usd.startsWith("-"), "negative usd display should keep sign");
assert.ok(negative.isLoss, "negative values should be marked as loss");

const zero = weiToUSD("0", 3400);
assert.equal(zero.usdRaw, 0);
assert.ok(!zero.isLoss);

console.log("All smoke tests passed");
