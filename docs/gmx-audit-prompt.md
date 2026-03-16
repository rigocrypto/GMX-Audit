# GMX Audit Prompt (Canonical)

Use this file as the single source of truth for GMX hunting scope, triage logic, and reporting rules.

## 0) Objective

Find practical, in-scope vulnerabilities across GMX v1/v2 contracts and deliver reproducible, economically-grounded findings.

## 0b) Mandatory Exclusion Filter (apply before any test)

Before testing anything, confirm it is **NOT** in this list:

- Timelock admin key exploits
- Fast Price Feed admin key exploits
- GLP pool value loss due to asset price decline
- Price manipulation on external exchanges
- Economically impractical exploits (cost > expected gain)
- Price feed delay/size exploits
- `GlpManager.getAum` rounding (known acceptable drift)
- `Vault.globalShortAveragePrices` drift within 1.5% threshold
- `Vault.setTokenConfig` / `clearTokenConfig` double-counting (known)
- `Vault.liquidatePosition` not paying sender (intentional)
- GLP burn+mint frontrun (fees assumed sufficient)
- Vesting schedule minor acceleration from multiple deposits
- `Vault.includeAmmPrice` / `useSwapPricing` not reset (won't be used)
- Hosting provider issues (Netlify, Cloudflare, IPFS)
- ProtocolGovernor front-run if bypassable via `#proposer=` parameter
- Any issue requiring leaked keys or privileged addresses

If a finding touches any of the above, label it `OUT_OF_SCOPE` and do **not** include it in `findings.md`.

## 1) Version Boundary Rules

### v1 contracts (Vault, GlpManager, Router, Trackers, Distributors, USDG, GMX, GLP, EsGMX, BnGMX, Vesters, OrderBook)

Focus on:

- `Vault.sol` accounting edge cases
- Reward tracker inflation/drain
- Vester edge cases (excluding documented multi-deposit acceleration)
- OrderBook manipulation

### v2 contracts (Handler/Utils/Store/DataStore/GLV stack)

Focus on:

- Cross-contract state consistency (`DataStore` as source of truth)
- `Handler -> Utils -> StoreUtils` call chains for reentrancy/state corruption
- GLV layer as highest-priority (newest and least battle-tested)

Do not assume v1 and v2 share state.

## 2) Priority Hunting Order

1. `ExchangeRouter` + `ExecuteDepositUtils` + `ExecuteWithdrawalUtils`
2. `Oracle.sol` + `ChainlinkDataStreamProvider` + `GmOracleProvider`
3. GLV layer (`GlvDepositUtils`, `GlvWithdrawalUtils`, `GlvShiftUtils`)

## 3) GMX v2 Priority Invariants

### A) Accounting invariants

- DataStore total collateral equals sum of all open position collaterals
- Pool token balance >= sum of pending deposits + open position collateral
- `ExecuteDepositUtils`: GM token supply delta matches deposit value / GM price
- `ExecuteWithdrawalUtils`: pool balance decreases by exactly withdrawn amount
- `FeeUtils`: fees collected equals fees distributed (no leakage/double-counting)

### B) Position lifecycle invariants

- `IncreasePositionUtils`: `sizeInTokens` increases proportionally to `sizeInUsd / markPrice`
- `DecreasePositionCollateralUtils`: collateral after decrease >= maintenance margin
- `LiquidationUtils`: liquidatable iff collateral < maintenance margin
- `PositionPricingUtils`: price impact cannot outperform zero-impact equivalent

### C) Oracle invariants

- Execution price remains inside `[minPrice, maxPrice]` for the block
- `ChainlinkDataStreamProvider` / `ChainlinkPriceFeedProvider`: stale price must revert
- `GmOracleProvider`: GM token price derived correctly from pool composition

### D) GLV invariants

- `GlvUtils`: GLV price == weighted sum of underlying GM pool prices
- `GlvDepositUtils` / `GlvWithdrawalUtils`: round-trip deposit+withdraw returns <= input
- `GlvShiftUtils`: shifting between GM pools preserves total GLV backing value

### E) Access control invariants

- `RoleStore`: no address holds both `CONTROLLER` and `LIQUIDATION_KEEPER`
- `Config` / `ConfigSyncer`: only Timelock modifies critical parameters
- `ExternalHandler`: cannot call arbitrary contracts with vault funds

### F) Cross-system/keeper invariants

- `OrderHandler` / `ExecuteOrderUtils`: same order cannot execute twice
- `AutoCancelSyncer`: cancelled orders cannot execute
- `GasUtils`: keeper reimbursement <= actual gas + configured buffer

## 3D) Cross-Chain Config Drift Check (High Priority)

For contracts deployed on both Arbitrum and Avalanche:

1. Fetch bytecode hash from both explorers
2. Flag differing hashes
3. Diff source for differing contracts and identify older/vulnerable chain
4. Compare `DataStore` key/value configs for exploitable chain divergence

Output file: `outputs/chain_diff.md`

## 5) Frontend/API (limited scope)

Only check:

- Unsafe RPC calls exposing private data without wallet consent
- Signature construction issues causing unintended transactions (chainId/domain mismatch)
- Supply chain risks in dependency graph affecting transaction builders

Skip:

- Hosting/CSP/clickjacking/social engineering/feature requests

Time budget: 15 minutes max, then return to contract work.

## 6) Severity Mapping (program-specific)

### Critical

- Direct theft of user funds
- Permanent fund freeze
- Protocol insolvency path
- GLP price manipulation causing holder losses
- Governance fund theft

### High

- Theft of unclaimed yield (esGMX/fees/rewards)
- Permanent freeze of unclaimed yield

### Medium

- Block stuffing that enables higher-severity outcomes
- Griefing with real user damage and no profit
- Keeper gas reimbursement theft
- Unbounded gas consumption in handlers
- Temporary fund freeze

### Skip / OUT_OF_SCOPE

- Anything from exclusion filter
- Best-practice-only critiques
- Rounding within documented acceptable bounds

## 7) Outputs

- `findings.md` for validated in-scope findings
- `outputs/chain_diff.md` for Arbitrum/Avalanche drift analysis
- PoC tests for each claim where possible

## 7b) Pre-submission Checklist

Before adding any finding to `findings.md`:

- [ ] Affected contract is in scope
- [ ] Exploit does not require admin/leaked keys
- [ ] Exploit is economically practical
- [ ] Not a documented known exclusion
- [ ] Working PoC or failing test exists (or marked hypothesis)
- [ ] Severity assigned using Section 6 mapping
- [ ] Reproduction path <= 10 maintainer steps

## 8) Execution Discipline

- Start with deterministic tests before fuzz variants
- Keep chain/fork context explicit in every artifact
- Stop and label as `OUT_OF_SCOPE` immediately when exclusion filter hits
- Prioritize high-impact surfaces before breadth scanning
