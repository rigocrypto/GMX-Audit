# Moonwell Integration Guide

This document explains how to integrate the Moonwell invariant harness into your existing `bounty-rotation-harness` (GMX audit) system.

## Overview

Your GMX harness is **protocol-agnostic** at the core:

- ✅ Proof packaging system (reusable)
- ✅ Triage engine (reusable)
- ✅ CI/GitHubActions scaffolding (reusable)
- ✅ Managed service scheduler (reusable)

**What changes per protocol:**
- Invariant suite (GMX perps → Moonwell lending)
- Action generators (trading → credit flows)
- State tracking (positions → accounts)

This means **you can bolt Moonwell onto your existing system with minimal changes**.

## Step 1: Wire Moonwell into Your Existing CI

Your current CI likely does:

```bash
npm run test:gmx-exploit-search:extended
npm run triage:ci
npm run dashboard -- --db outputs/metrics/results.db --out outputs/metrics/dashboard.html
```

Add Moonwell parallel runs:

```bash
# Run both GMX and Moonwell
npm run test:gmx-exploit-search:extended &
npm run test:moonwell:extended &
wait

# Single triage pass for both
npm run triage:ci --dir exploit-proofs

# Single dashboard for all proofs
npm run dashboard -- --db outputs/metrics/results.db --out outputs/metrics/dashboard.html
```

Or update `bounty-rotation` script in `package.json`:

```json
{
  "scripts": {
    "bounty-rotation": "npm run test:gmx-exploit-search:extended && npm run test:moonwell:extended && npm run triage:ci && npm run dashboard"
  }
}
```

## Step 2: Extend Proof Schema (Optional)

Your `triage.ts` already handles multi-protocol proofs via the `detector` field:

```json
{
  "chain": "arbitrum",
  "block": 123456,
  "detector": "GmxPositionLeakage"  // ← identifies protocol
}
```

For Moonwell, use:

```json
{
  "chain": "base",
  "block": 18500000,
  "detector": "MoonwellProtocolInsolvency"  // ← Moonwell detector
}
```

The triage engine automatically dedupes by `content_hash`, so mixed protocols work seamlessly.

## Step 3: Add npm Scripts

Update your `package.json`:

```json
{
  "scripts": {
    "test:moonwell": "hardhat test test/moonwell/moonwell-invariants.spec.ts --network hardhat",
    "test:moonwell:quick": "MOONWELL_FUZZ_RUNS=10 npm run test:moonwell",
    "test:moonwell:extended": "MOONWELL_FUZZ_RUNS=500 npm run test:moonwell",
    "test:moonwell:fuzz": "cross-env GMX_ENABLE_REAL_MUTATIONS=true npm run test:moonwell:extended",
    
    "triage:moonwell": "ts-node scripts/triage.ts --dir exploit-proofs/moonwell --out outputs/triage/moonwell-result.json",
    
    "bounty-rotation:full": "npm run bounty-rotation && npm run test:moonwell:extended && npm run triage:ci",
    
    "generate-immunefi:moonwell": "ts-node scripts/generateImmunefiReport.ts --proof exploit-proofs/moonwell/*.json",
    
    "managed:run:moonwell": "ts-node scripts/managed/runClient.ts --client moonwell"
  }
}
```

## Step 4: Hardhat Network Config (if needed)

Your existing `hardhat.config.ts` already supports forking. Just add chain config:

```typescript
networks: {
  hardhat: {
    forking: {
      enabled: process.env.FORKING !== "false",
      url: getChainRpc(process.env.MOONWELL_CHAIN || "base"),
      blockNumber: parseInt(process.env.MOONWELL_FORK_BLOCK || "18000000")
    }
  }
}

function getChainRpc(chain: string): string {
  switch (chain) {
    case "base":
      return process.env.BASE_RPC_URL || "https://mainnet.base.org";
    case "optimism":
      return process.env.OP_RPC_URL || "https://mainnet.optimism.io";
    case "arbitrum":
      return process.env.ARB_RPC_URL || "https://arb1.arbitrum.io/rpc";
    default:
      throw new Error(`Unknown chain: ${chain}`);
  }
}
```

## Step 5: Configure .env

Add to `.env.example`:

```bash
# ============================================================================
# MOONWELL FORK CONFIG
# ============================================================================
MOONWELL_CHAIN=base
MOONWELL_FORK_BLOCK=18500000
MOONWELL_FUZZ_RUNS=100
MOONWELL_FUZZ_SEED=42

# Chain-specific RPCs (optional, fallback to defaults)
BASE_RPC_URL=https://mainnet.base.org
OP_RPC_URL=https://mainnet.optimism.io
ARB_RPC_URL=https://arb1.arbitrum.io/rpc
```

## Step 6: Triage Multi-Protocol (Optional Enhancement)

Your `triage.ts` can group proofs by protocol:

```typescript
interface TriageResult {
  schema_version: 1;
  proofs: ProofEntry[];
  byProtocol: {
    gmx: ProofEntry[];
    moonwell: ProofEntry[];
  };
}
```

Modify `triage.ts`:

```typescript
const byProtocol: { [key: string]: ProofEntry[] } = {};

for (const proof of proofs) {
  const protocol = proof.detector.toLowerCase().includes("gmx") ? "gmx" : 
                   proof.detector.toLowerCase().includes("moonwell") ? "moonwell" :
                   "unknown";
  
  if (!byProtocol[protocol]) byProtocol[protocol] = [];
  byProtocol[protocol].push(proof);
}

return {
  schema_version: 1,
  proofs,
  byProtocol,
  summary_text: generateSummary(byProtocol)
};
```

## Step 7: Extend Dashboard (Optional)

Your `generateDashboard.ts` already reads from the SQLite results DB. To filter by protocol:

```typescript
// In generateDashboard.ts
const moonwellProofs = allProofs.filter(p => 
  p.detector.toLowerCase().includes("moonwell")
);

const gmxProofs = allProofs.filter(p => 
  p.detector.toLowerCase().includes("gmx")
);

// Generate dual tabs
html += `<div id="gmx-tab">...</div>`;
html += `<div id="moonwell-tab">...</div>`;
```

## Step 8: Managed Service (Optional)

If you run managed mode, you can create a Moonwell client config:

```typescript
// scripts/managed/clients.ts
export const CLIENTS = {
  "gmx": {
    testSuite: "test:gmx-exploit-search:extended",
    proofDir: "exploit-proofs/gmx",
    rpc: "https://arb1.arbitrum.io/rpc"
  },
  "moonwell": {
    testSuite: "test:moonwell:extended",
    proofDir: "exploit-proofs/moonwell",
    rpc: "https://mainnet.base.org"
  }
};
```

Then run:

```bash
npm run managed:run -- --client moonwell --once
npm run managed:run -- --client gmx --once
npm run managed:run -- --client all  # Both
```

## Architecture Diagram

```
bounty-rotation-harness (existing)
├── GMX Suite
│   ├── test/gmx-invariants/
│   ├── exploit-proofs/gmx/
│   └── [existing scripts]
│
└── Moonwell Suite (NEW - bolt-on)
    ├── test/moonwell/
    │   ├── MoonwellInvariant.t.sol      (Foundry, optional)
    │   ├── moonwell-harness.ts          (Action adapter)
    │   ├── moonwell-invariants.spec.ts  (Fuzz harness)
    │   ├── moonwell-config.ts           (Deployments)
    │   └── README.md
    │
    ├── exploit-proofs/moonwell/
    └── outputs/triage/moonwell-result.json

Shared (reused)
├── scripts/triage.ts           (works for all protocols)
├── scripts/generateDashboard.ts (consolidates all)
├── scripts/generateImmunefiReport.ts (works for all)
├── .github/workflows/ (extend CI)
└── hardhat.config.ts (detection logic)
```

## Testing Your Integration

### 1. Quick smoke test

```bash
# Quick Moonwell test
npm run test:moonwell:quick

# Check output
ls -la exploit-proofs/moonwell/
```

### 2. Full rotation

```bash
# Both GMX and Moonwell
npm run bounty-rotation:full

# Check triage results
cat outputs/triage/triage-result.json | jq '.byProtocol'
```

### 3. CI Dry-run

```bash
# Simulate GitHub Actions locally
act -j test -s GITHUB_TOKEN=$TOKEN
```

## Multi-Chain Rotation

If you want to hunt across Base, Optimism, and Arbitrum in one CI run:

```bash
# scripts/rotateChains.sh
#!/bin/bash
for CHAIN in base optimism arbitrum; do
  echo "Testing $CHAIN..."
  MOONWELL_CHAIN=$CHAIN npm run test:moonwell:extended
done
npm run triage:ci
```

Add to `.github/workflows/moonwell-rotate.yml`:

```yaml
- run: bash scripts/rotateChains.sh
```

## Troubleshooting Integration

### Error: "Cannot run test:moonwell"
→ Ensure `hardhat.config.ts` is configured for fork detection

### Proofs not deduping
→ Check triage.ts is using `content_hash`, not `proof_hash`

### Dashboard not showing Moonwell tabs
→ Verify `generateDashboard.ts` reads from `exploit-proofs/`  (not just `exploit-proofs/gmx/`)

### RPC rate limits
→ Add backoff in harness:

```typescript
async sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async executeActionWithRetry(action: MoonwellActionInput, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await executeAction(action);
    } catch (e) {
      if (i < maxRetries - 1) {
        await this.sleep(1000 * (i + 1));
      } else {
        throw e;
      }
    }
  }
}
```

## Performance Tips

1. **Parallel runs** (your CI is likely already doing this):
   ```bash
   npm run test:gmx-exploit-search:extended &
   npm run test:moonwell:extended &
   wait
   ```

2. **Reduce fuzz runs in dev**:
   ```bash
   MOONWELL_FUZZ_RUNS=10 npm run test:moonwell
   ```

3. **Cache fork blocks**:
   ```bash
   # Hardhat caches fork state, no need to re-fetch if block stays same
   MOONWELL_FORK_BLOCK=18000000 npm run test:moonwell
   ```

4. **Dedicated archive RPC** (for managed mode):
   ```bash
   # Use Alchemy/Infura/other with higher rate limits
   BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/$KEY
   ```

## Next Steps

1. ✅ **Wire up Moonwell tests** → `npm run test:moonwell:extended`
2. ✅ **Add npm scripts** → Update `package.json`
3. ✅ **Test locally** → `npm run bounty-rotation:full`
4. ✅ **Extend CI** → Add Moonwell to GitHub Actions
5. ⏭️  **Customize invariants** → Add protocol-specific logic
6. ⏭️  **Deploy to Managed** → Use managed:run scripts

## Resources

- **Moonwell Docs**: https://docs.moonwell.fi/
- **Compound Reference**: https://compound.finance/docs/governance
- **Your GMX Harness**: `test/gmx-invariants/harness.ts`
- **Proof Format**: `exploit-proofs/demo-proof.json`

---

**TL;DR:** Your harness is ready for Moonwell. Just:

1. Run `npm run test:moonwell:extended`
2. Existing triage/dashboard auto-consolidate
3. Multi-protocol CI is built-in
4. Proof packaging works for both

🚀 You're ready to hunt.
