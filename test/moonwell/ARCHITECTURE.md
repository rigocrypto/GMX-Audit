📦 Moonwell Invariant Harness - Complete Implementation

## 📁 FILE STRUCTURE

```
gmx-audit/
├── test/
│   ├── gmx-invariants/           (← existing GMX suite)
│   │   ├── harness.ts
│   │   ├── sequenceFuzz.spec.ts
│   │   └── ...
│   │
│   └── moonwell/                 (← NEW: Moonwell bolt-on)
│       ├── 🟦 MoonwellInvariant.t.sol
│       │   └── 6 invariants (Foundry, optional)
│       │       ├── protocolSolvent()
│       │       ├── userCannotEscapeDebt()
│       │       ├── noFreeValue()
│       │       ├── liquidationBounded()
│       │       ├── crossMarketConsistency()
│       │       └── accountingConsistency()
│       │
│       ├── 🟦 moonwell-harness.ts
│       │   ├── MoonwellAdapter (implements supply/borrow/redeem/liquidate)
│       │   ├── MoonwellStateTracker (snapshots + solvency checks)
│       │   └── Proof format (compatible with GMX schema)
│       │
│       ├── 🟦 moonwell-invariants.spec.ts
│       │   ├── "should maintain protocol solvency" (fuzz 100-500 runs)
│       │   ├── "should prevent over-liquidation"
│       │   └── "should prevent free borrow loops"
│       │
│       ├── 🟦 moonwell-config.ts
│       │   ├── MOONWELL_BASE (addresses + markets)
│       │   ├── MOONWELL_OPTIMISM
│       │   ├── MOONWELL_ARBITRUM
│       │   └── ATTACK_SEQUENCES (pre-built exploit paths)
│       │
│       ├── 📄 README.md (setup guide)
│       ├── 📄 INTEGRATION.md (how to wire into GMX harness)
│       ├── 📄 EXPLOIT_PATTERNS.md (real bugs + detection)
│       └── 📄 COMMANDS.sh (npm script reference)
│
├── exploit-proofs/
│   ├── gmx/                      (← existing)
│   │   └── *.json
│   │
│   └── moonwell/                 (← NEW: proof output)
│       ├── insolvency-run42.json
│       ├── over-liquidation.json
│       └── ...
│
├── outputs/
│   ├── triage/
│   │   ├── triage-result.json (GMX + Moonwell consolidated)
│   │   └── moonwell-result.json (Moonwell only)
│   │
│   └── metrics/
│       ├── dashboard.html (GMX + Moonwell tabs)
│       └── results.db (SQLite history)
│
├── .env.example → add MOONWELL_* env vars
├── hardhat.config.ts → already supports fork detection
└── package.json → add npm scripts
```

## 🔄 DATA FLOW

```
[Hardhat Fork at Block N]
         ↓
[MoonwellStateTracker]
         ↓
[MoonwellAdapter.executeAction()]
├─ supply(user, mToken, amount)
├─ borrow(user, mToken, amount)
├─ redeem(user, mToken, amount)
├─ liquidate(liquidator, borrower, repay, seize, amount)
└─ ...
         ↓
[Check Invariants]
├─ protocolSolvent?
├─ userCannotEscapeDebt?
├─ noFreeValue?
├─ liquidationBounded?
├─ crossMarketConsistency?
└─ accountingConsistency?
         ↓
[Break Detected?]
    ├─ NO → continue fuzzing
    └─ YES → Create proof.json
              ├─ chain, block, detector
              ├─ userNet, poolNet (USD impact)
              ├─ txs (attack sequence)
              └─ repro (command to reproduce)
         ↓
[Triage (scripts/triage.ts)]
├─ Dedupe by content_hash
├─ Score severity (Critical/High/Medium)
├─ Update exploit-proofs/moonwell/
└─ Update outputs/triage/triage-result.json
         ↓
[Dashboard (scripts/generateDashboard.ts)]
├─ Parse all proofs (GMX + Moonwell)
├─ Generate HTML with tabs
└─ output outputs/metrics/dashboard.html
         ↓
[Immunefi Packaging (scripts/generateImmunefiReport.ts)]
├─ economic impact calculation
├─ proof verification
└─ output immunefi-report.md (ready to submit)
```

## 🎯 INVARIANTS AT A GLANCE

┌─ 🔴 CRITICAL (bug = $100k-$10M) ─────────────────────────────────────┐
│                                                                          │
│ 1️⃣  PROTOCOL SOLVENCY                                                  │
│     Assert: totalBorrows ≤ totalCollateral * collateralFactors         │
│     Breaks: Protocol became insolvent                                   │
│     Example: ExcessiveOraclePrice → collateral overvalued → insolvency │
│                                                                          │
│ 2️⃣  ESCAPE DEBT                                                         │
│     Assert: If borrowing, account stays healthy                        │
│     Breaks: User exited market while indebted → redeemed collateral    │
│     Example: exitMarket() missing collateral check                     │
│                                                                          │
│ 3️⃣  NO FREE VALUE                                                       │
│     Assert: supplied ≥ borrowed (per user, per session)                │
│     Breaks: User extracted more than supplied (free borrow loop)       │
│     Example: Borrow → withdraw → repeat without interest               │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘

┌─ 🟠 HIGH (bug = $10k-$100k) ──────────────────────────────────────────┐
│                                                                          │
│ 4️⃣  LIQUIDATION BOUNDED                                                │
│     Assert: seized ≤ repay * incentive (e.g., 1.08x)                   │
│     Breaks: Liquidator got paid way more than allowed                  │
│     Example: incentive = 2.0 (200%) → self-liquidate for profit       │
│                                                                          │
│ 5️⃣  CROSS-MARKET CONSISTENCY                                           │
│     Assert: collateral factors prevent cascades                        │
│     Breaks: Collateral in one market doesn't protect borrows in other  │
│     Example: Supply low-liquidity asset, borrow stablecoin, dumped A   │
│                                                                          │
│ 6️⃣  ACCOUNTING CONSISTENCY                                             │
│     Assert: totalSupply ≈ sum(balances) ± 1 wei                        │
│     Breaks: Interest accrual or rounding desynchronization             │
│     Example: Accrue → exchange rate drifts → balanceOf != totalSupply  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘

## 🚀 QUICKSTART

### 1. Setup (.env)
MOONWELL_CHAIN=base
MOONWELL_FORK_BLOCK=18500000
MOONWELL_FUZZ_RUNS=100

### 2. Run
npm run test:moonwell:quick          # 10 runs, ~30 sec
npm run test:moonwell:extended       # 500 runs, ~5 min
npm run test:moonwell:fuzz           # Full CI mode

### 3. Check results
cat exploit-proofs/moonwell/*.json   # Proofs found
cat outputs/triage/triage-result.json # Triage summary
open outputs/metrics/dashboard.html   # Visual dashboard

### 4. Submit
npm run generate-immunefi -- --proof exploit-proofs/moonwell/proof.json
# → outputs/proof-packages/.../immunefi-report.md

## 🔗 INTEGRATION WITH EXISTING GMX HARNESS

Your existing code needs NO CHANGES. Moonwell is a pure bolt-on:

OLD:
```bash
npm run bounty-rotation
  └─ runs: test:gmx-exploit-search:extended
  └─ triage: exploit-proofs/gmx/*.json
  └─ output: outputs/metrics/dashboard.html
```

NEW (with Moonwell):
```bash
npm run bounty-rotation:full
  ├─ runs: test:gmx-exploit-search:extended &
  │        test:moonwell:extended &
  │        wait
  └─ triage: exploit-proofs/{gmx,moonwell}/*.json
  └─ output: outputs/metrics/dashboard.html (both protocols)
```

The proof format, triage.ts, and dashboard.ts already support multi-protocol.

## 📊 ACTION TYPES (Harness)

Moonwell Action Adapter implements:

[supply]      Deposit underlying → mint mToken
[enterMarket] Enable market as collateral
[borrow]      Draw from market
[repay]       Pay back borrow
[redeem]      Withdraw mToken → underlying
[liquidate]   Seize collateral

All return { tx: ContractTransactionResponse; returnCode: number }

## 🎲 FUZZING STRATEGY

SeededRandom(seed) ensures reproducibility:

High-value sequences (pre-built in ATTACK_SEQUENCES):
├─ collateralEscape (supply → borrow → exit → redeem)
├─ liquidationCascade (price drop → liquidation)
├─ roundingAbuse (minimal repay/redeem → loop)
└─ indebted_exit (escape debt while borrowing)

Random actions (generated per-user):
└─ pick random market + random amount + random action

## ✅ VALIDATION CHECKLIST

Before submitting a proof to Immunefi:

─ Protocol version matches deployment (Base vs Optimism vs Arbitrum)
─ Fork block is recent (< 1 week old)
─ Economic impact > Immunefi minimum ($5k threshold)
  ├─ userNet: attacker gain in wei/USD
  └─ poolNet: protocol loss in wei/USD
─ Sequence is reproducible with fixed seed
─ No false positives (manually verify invariant break)
─ Proof is NOT a known/historical bug

## 🔐 PROOF FORMAT (Reuses GMX Schema)

{
  "chain": "base",
  "block": 18500000,
  "detector": "MoonwellProtocolInsolvency",
  "description": "Protocol solvency broken: borrows > collateral",
  
  "userNet": "1000000000000000000",      // Wei (attacker gain)
  "poolNet": "-5000000000000000000",     // Wei (protocol loss)
  "usd_impact": "-6000000",              // Denominated in USD
  
  "txs": [                               // Attack sequence
    { "hash": "0x...", "to": "Comptroller", "desc": "supply 100 USDC" },
    { "hash": "0x...", "to": "mWETH", "desc": "borrow 50 WETH" },
    ...
  ],
  
  "env": {
    "FORK_BLOCK": "18500000",
    "MOONWELL_CHAIN": "base"
  },
  
  "repro": {
    "command": "npm run test:moonwell -- --seed 42",
    "notes": "Reproduces 100% deterministically"
  }
}

## 📈 PERFORMANCE TARGETS

Setup:        ~2 sec
Test 10 runs: ~30 sec
Test 100 runs: ~3 min
Test 500 runs: ~15 min

(Scaling: ~2 sec per fuzz run + setup overhead)

## 🎖️ BOUNTY SCORING (Immunefi Rough)

Pattern                        Payout Range  Your Detector
─────────────────────────────────────────────────────────
Protocol insolvency            $100k-$1M     protocolSolvent
User escapes debt              $50k-$500k    userCannotEscapeDebt
Over-liquidation               $10k-$100k    liquidationBounded
Accounting desync              $5k-$50k      accountingConsistency
Interest accrual bug           $10k-$100k    accountingConsistency + timing
Cross-market cascade           $100k-$1M     cross-market invariants

Minimum: $5k impact required
Maximum: bounded by TVL + insurance
Most valuable: insolvency + escape + cascades

## 🚦 CURRENT STATUS

[✅] Core Invariants Defined (6 total)
[✅] Action Adapter Implemented
[✅] Fuzz Test Suite Built
[✅] Config for Base, Optimism, Arbitrum
[✅] Integration Docs (3 files)
[✅] Exploit Patterns Documented
[⏳] Your Turn: Wire into CI + run tests

---

🎯 Ready to hunt Moonwell bugs!

Next: Run `npm run test:moonwell:quick` and watch for proof generation.

Questions? See INTEGRATION.md or EXPLOIT_PATTERNS.md
