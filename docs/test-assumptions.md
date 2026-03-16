# Invariant Test Assumptions

This document captures the explicit assumptions, constraints, and interpretation boundaries for the GMX v2 invariant suite.

## 1. Fork & Determinism

- Network: Arbitrum One (forked into local Hardhat network)
- Fork block pin: `420000000`
- RPC source: `ARBITRUM_RPC` or `ARBITRUM_RPC_URL` in `.env`
- Runtime model: per-test and per-iteration state reset with `evm_snapshot` and `evm_revert`

Tests depend on historical state at the pinned block. Changing the fork block can change balances, liquidity, and oracle execution paths.

## 2. Funding Model

Tests use impersonation-based funding to provision ephemeral signers.

- Gas funding: `hardhat_setBalance`
- Collateral funding: transfer from token holder addresses via account impersonation

Whales currently used:

- WETH/USDC collateral funding: `GMX_WHALE_ADDRESS` from `.env`
- WBTC/USDC collateral funding: `GMX_WBTC_WHALE` from `.env`
- Block-pinned WBTC selection at `420000000`: `0x47c031236e19d024b42f8ae6780e44a573170703`

Important: market-token-holder impersonation is a test-only setup primitive. It is not a production user behavior model.

## 3. Oracle / Price Model

- Real-order execution paths use the configured fork oracle/data-stream stack.
- Liquidation scenarios are exercised under controlled price conditions appropriate for liquidation triggers.
- Harness parameters (collateral/leverage bounds, profile runs/timeouts) are configured in `test/gmx-invariants/harness.ts`.
- Price acceptability and deviation constraints are assumed to match the configured execution path for the pinned fork state.

## 4. Interpretation Boundaries

A green suite supports this claim:

- No invariant violations were observed for covered scenarios on the pinned fork state and configuration.

A green suite does not prove:

- protocol correctness across all future blocks
- protocol correctness across all markets/tokens and all oracle conditions
- absence of issues outside this suite's invariant scope

This suite is designed to catch:

- fee reconciliation mismatches
- pool/accounting drift
- liquidation-related bad debt or inconsistent position clearing
- AUM consistency regressions
- state-leak/drift across deterministic open/close/increase/withdraw/liquidate sequences

## 5. Reproduce Exactly

```bash
# Prepare .env with ARBITRUM_RPC(_URL), FORK_BLOCK=420000000, and required GMX_* addresses
npm ci
npm run test:gmx-invariants
npm run test:gmx-invariants:stress
```

To discover funded whale candidates for a token at the pinned block:

```bash
npx ts-node scripts/findTokenWhale.ts <token-address>
```

## 6. Extended Scope: GLV Vault Accounting (Task A)

**Coverage file:** `test/gmx-invariants/glvAccounting.spec.ts`

**Architecture note:** GLV (vault-of-vaults) deposits are two-phase.
1. On-chain: the user sends collateral tokens to `GlvVault` and a deposit request is recorded.
2. Off-chain: a keeper submits a signed oracle price and calls `executeGlvDeposit`; only then are GLV market tokens minted to the receiver.

**What the tests cover:**
- Deposit creation sends the exact `amount` to `GlvVault` — no token leakage in the creation half.
- Concurrent deposit requests leave vault balance strictly monotonically increasing.
- `totalSupply` of the GLV ERC-20 is non-negative and consistent with on-chain state.

**What the tests do NOT cover:**
- Actual GLV token minting — that requires a live keeper with a signed oracle payload and is outside the forked-env test scope.
- Withdrawal execution (same keeper dependency).

**Addresses used:**
- `GlvRouter`: `0x7EAdEE2ca1b4D06a0d82fDF03D715550c26AA12F`
- `GlvVault`: `0x393053B58f9678C9c28c2cE941fF6cac49C3F8f9`
- `GLV[WETH-USDC] token`: `0x528A5bac7E746C9A509A1f4F6dF58A03d44279F9`
- `GLV[WBTC-USDC] token`: `0xdF03EEd325b82bC1d4Db8b49c30ecc9E05104b96`

---

## 7. Extended Scope: ADL Territory (Task B)

**Coverage location:** `describe("ADL territory…")` block inside `test/gmx-invariants/sequenceFuzz.spec.ts`

**Architecture note:** `AdlHandler.executeAdl` requires a signed oracle payload (`OracleUtils.SetPricesParams`) produced by a GMX keeper.  This off-chain oracle dependency cannot be satisfied in a forked Hardhat environment without running a real keeper process.

**Approach:** The test drives the pool into an "ADL-territory" state (three large long positions opening simultaneously) and then asserts all accounting invariants hold throughout the lifecycle:
- `assertNoTheft` — no token balance reduction in the vault
- `assertPoolMonotonic` — pool value does not shrink due to user activity
- `assertCoreInvariants` — core GMX accounting identities maintained

A violation here would indicate the invariants break *before* ADL is triggered, which is a distinct (and independently reportable) issue.

**Address used:**
- `AdlHandler`: `0x262df96a3a35D0A7950C5669238662df58Ae8bf7`

---

## 8. Extended Scope: Output-Token Swap Actions (Task C)

**Coverage:** `CLOSE_LONG_TOKEN_OUTPUT` / `CLOSE_SHORT_TOKEN_OUTPUT` in `AdversarialActionType` enum (harness.ts) and in the grammar via `fc.constantFrom` (sequenceFuzz.spec.ts)

**Purpose:** These action types close a position requesting the *opposite* collateral token as output (long closes requesting short token, short closes requesting long token), exercising the intra-order swap path.  The fuzzer can now construct sequences such as:
`openLong → CLOSE_LONG_TOKEN_OUTPUT` where the user requests WETH as output instead of USDC. Any accounting drift from the swap leg is caught by the standard `ExploitDetector` assertions.

---

## 9. Extended Scope: ExternalHandler Reentrancy (Task D)

**Coverage file:** `test/gmx-invariants/externalHandlerFuzz.spec.ts`

**Critical finding:** `ExternalHandler.makeExternalCalls` has **no access-control guard**.  Any EOA or contract may call it.  The contract's security model relies entirely on:
1. `nonReentrant` modifier — prevents re-entering `makeExternalCalls` from within a callback.
2. `isContract()` check on every target — prevents calling EOA addresses.
3. No persistent token balances — ExternalHandler holds no funds at rest.

**What the tests cover:**
- Deployed code present at the expected address.
- Reentrancy guard blocks a self-referential call.
- EOA target address rejected with `InvalidExternalCallTarget`.
- Input-array length mismatch reverts.
- Failed external call propagates (not silently swallowed).

**Scope implication:** Because the contract has no access control, any finding that exploits an *external* contract's state via ExternalHandler would need to target the callback target's logic, not ExternalHandler itself.

**Address used:**
- `ExternalHandler`: `0x389CEf541397e872dC04421f166B5Bc2E0b374a5`

---

## 10. Extended Scope: SubaccountRouter Delegation Limits (Task E)

**Coverage file:** `test/gmx-invariants/subaccountFuzz.spec.ts`

**Architecture:**
1. A main account calls `addSubaccount(subAddr)` to register a sub-account.
2. The main account calls `setMaxAllowedSubaccountActionCount(subAddr, ACTION_TYPE, N)` to cap cumulative allowed actions.
3. The main account may optionally call `setSubaccountExpiresAt(subAddr, ACTION_TYPE, timestamp)` for time-based expiry.
4. The sub-account calls `createOrder(mainAccountAddr, params)` — SubaccountRouter acts on behalf of `mainAccountAddr`.

**Action-type key:**
```
SUBACCOUNT_ORDER_ACTION = keccak256(abi.encode("SUBACCOUNT_ORDER_ACTION"))
```

**What the tests cover:**
- Unregistered sub-account → `SubaccountNotAuthorized` revert.
- Registered sub-account with `maxAllowedCount=0` → `MaxSubaccountActionCountExceeded` revert.
- `addSubaccount` + `removeSubaccount` cycle → post-removal call reverts.
- `setSubaccountExpiresAt` with past timestamp → call reverts.
- Sub-account cannot gain authority over other accounts via self-registration.

**Scope implication:** A sub-account bypassing the action-count cap (without main-account consent) would be a Critical vulnerability.  A sub-account persisting after `removeSubaccount` would be a Critical vulnerability.  These tests assert both bounds hold.

**Address used:**
- `SubaccountRouter`: `0xdD00F639725E19a209880A44962Bc93b51B1B161`
- `DataStore`: `0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8`

---

## 11. Running the Extended Suite

```bash
# Existing baseline (must stay green)
npm run test:gmx-invariants

# All exploit-search specs including new extended scope
npm run test:gmx-exploit-search:extended

# Complete invariant suite including all new specs
npm run test:gmx-invariants:full
```

Exploit proofs (if any invariant fires) are written to `exploit-proofs/*.json`.
