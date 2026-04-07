# Moonwell Invariant Harness Setup

This is a Moonwell (Compound-fork) adaptation of the `bounty-rotation-harness` GMX security scanner.

## Quick Start

### 1. Add your Moonwell deployments to `.env`

```bash
# Moonwell Base (production)
MOONWELL_CHAIN=base
MOONWELL_COMPTROLLER=0x... # Unitroller proxy address
MOONWELL_ORACLE=0x...       # Oracle address

# Optional: override fork block
MOONWELL_FORK_BLOCK=18500000

# Fuzz settings
MOONWELL_FUZZ_RUNS=500
MOONWELL_FUZZ_SEED=42
```

### 2. Identify your markets

For Base Moonwell, typical markets are:
- **mUSDC** → USDC collateral
- **mWETH** → WETH collateral
- **mCBETH** → cbETH collateral
- **mUSDe** → USDe borrow
- **mDAI** → DAI borrow

Check [Moonwell Contracts](https://docs.moonwell.fi/) for current addresses.

### 3. Wire markets into `moonwell-invariants.spec.ts`

Update the `MARKETS_NATIVE` array:

```typescript
const MARKETS_NATIVE = [
  { symbol: "mUSDC", address: "0xeefe..." },
  { symbol: "mWETH", address: "0xd5..." },
  { symbol: "mCBETH", address: "0x..." }
];
```

### 4. Run the fuzz suite

```bash
# Full fuzz (500 runs)
npm run test:moonwell:fuzz

# Minimal test (5 runs)
npm run test:moonwell:quick

# Extended hunt (with liquidation simulation)
npm run test:moonwell:extended
```

## Architecture

### Files

| File | Purpose |
|------|---------|
| `MoonwellInvariant.t.sol` | Foundry invariant contracts (optional, can be standalone) |
| `moonwell-harness.ts` | Core harness: action adapter, state tracking, proof format |
| `moonwell-invariants.spec.ts` | Hardhat fuzz test suite (main execution) |
| `moonwell-config.ts` | Contract addresses and configuration |

### Key Invariants

#### 🔴 Critical (High Bounty Value)
1. **Protocol Solvency**: `totalBorrows ≤ totalCollateral * collateralFactors`
   - Breaks = insolvency ($100k+)
   
2. **User Cannot Escape Debt**: If borrowing, account must stay healthy
   - Breaks = unauthorized withdrawal ($50k+)
   
3. **No Free Value**: Sum(supplied) ≥ Sum(borrowed) per user
   - Breaks = borrow loop ($50k+)

#### 🟠 High
4. **Liquidation Bounded**: Seized amount ≤ allowed incentive
5. **Cross-Market Consistency**: Collateral factors prevent cascades
6. **Accounting Sanity**: totalSupply matches sum of balances

### Action Types

```typescript
type MoonwellActionType = 
  | "supply"       // Deposit underlying → mint mToken
  | "enterMarket"  // Enable market as collateral
  | "borrow"       // Draw from market
  | "repay"        // Pay back borrow
  | "redeem"       // Withdraw mToken → underlying
  | "liquidate"    // Seize collateral
```

### Proof Format

When an invariant breaks, a proof JSON is captured:

```json
{
  "chain": "base",
  "block": 18500000,
  "detector": "ProtocolInsolvency",
  "description": "Protocol became insolvent: borrows > collateral",
  "userNet": "1000000000000000000",
  "poolNet": "-1000000000000000000",
  "txs": [
    { "hash": "0x...", "to": "0x...", "desc": "supply then borrow" }
  ],
  "env": { "FORK_BLOCK": "18500000", "MOONWELL_CHAIN": "base" },
  "repro": { "command": "npm run test:moonwell -- --seed 42" }
}
```

You can then auto-generate an Immunefi report:

```bash
npm run generate-immunefi -- --proof exploit-proofs/moonwell/proof.json
```

## Extending the Harness

### Add a new invariant

In `moonwell-invariants.spec.ts`:

```typescript
it("should prevent flash loan attack", async function () {
  // 1. Setup initial state
  const borrower = ctx.users[0];
  
  // 2. Execute attack sequence
  await executeAction(borrower, { type: "borrow", market: "mUSDC", amount: BigInt(1e20) });
  
  // 3. Assert invariant
  const { solvent } = await tracker.checkProtocolSolvency();
  expect(solvent).to.be.true;
});
```

### Add a new action

In `MoonwellAdapter`:

```typescript
async delegateBorrow(ctx: MoonwellInvariantContext, input: MoonwellActionInput) {
  // Borrow on behalf of another user (edge case)
  const mToken = ctx.mTokens.get(input.market!);
  return await mToken.borrowOnBehalf(input.user, input.amount);
}
```

### Test against different chains

```bash
# Base
MOONWELL_CHAIN=base npm run test:moonwell

# Optimism
MOONWELL_CHAIN=optimism npm run test:moonwell

# Arbitrum
MOONWELL_CHAIN=arbitrum npm run test:moonwell
```

## Real-World Bug Hunting Tips

### 1. Liquidation Edge Cases

These often hide bugs:

```typescript
// Liquidate with stale price
// Repay with wrapped token (fee-on-transfer abuse)
// Partial liquidation + re-enter market
// Liquidate last collateral while still borrowing
```

### 2. Cross-Market Attacks

```typescript
// Supply in low-liquidity asset (inflated price)
// Borrow stablecoin against it
// Dump the low-liquidity asset, liquidation cascade
```

### 3. Interest Accrual Abuse

```typescript
// Accrue interest
// Exit market
// Reenter with lower borrow balance
// Accounting drift = free borrow
```

### 4. Oracle Manipulation (in fork)

If oracle is settable in your fork environment:

```typescript
// Supply A (collateral)
// Borrow B
// Drop price of A to trigger liquidation
// Liquidator seizes more than allowed incentive
```

## Profiling & Optimization

### Slow runs?

```bash
# Reduce fuzz runs for debugging
MOONWELL_FUZZ_RUNS=10 npm run test:moonwell
```

### Memory usage high?

```bash
# Run single invariant at a time
npx hardhat test test/moonwell/moonwell-invariants.spec.ts --grep "Protocol Solvency"
```

## CI Integration

Add to `.github/workflows/moonwell-audit.yml`:

```yaml
name: Moonwell Continuous Audit

on:
  schedule:
    - cron: "0 2 * * *"  # Daily at 2 AM UTC

jobs:
  fuzz:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run test:moonwell:extended
      - name: Triage & Alert
        if: failure()
        run: npm run triage:moonwell && npm run alert:slack
```

## Troubleshooting

### "Unknown market mUSDC"
→ Check MARKETS_NATIVE in config matches actual deployment

### "Comptroller error in getAccountLiquidity"
→ User may not be in any markets yet; expected error

### "Cannot call mint (not enough underlying balance)"
→ Add test token minting to `setUp()` phase

### Fork timeout on historical blocks
→ Check archive RPC endpoint; may need upgrade

## Next Steps

1. **Deploy to your CI** → Daily regression runs
2. **Customize invariants** → Add Moonwell-specific logic
3. **Connect alerts** → Slack webhook on Critical findings
4. **Generate white-label reports** → For stakeholders

## Support

- **Docs**: [Moonwell Protocol Docs](https://docs.moonwell.fi/)
- **Compound Spec**: [Compound Governance](https://compound.finance/)
- **Questions**: Check DMM (Moonwell DeFi) forums

---

**Advanced**: Want to integrate with your existing GMX harness?

See `test/gmx-invariants/harness.ts` for reference. The Moonwell adapter follows the same `ActionAdapter` interface, so you can:

```typescript
// Reuse existing proof packaging
import { generateProofPackage } from "../gmx-invariants/harness";

const package = await generateProofPackage(moonwellProof);
console.log("📦 Immunefi-ready report:", package.reportPath);
```
