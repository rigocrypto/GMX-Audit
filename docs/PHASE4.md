# Phase 4 Gate Runner

This file is the actionable Phase 4 checklist with commands and latest outputs.

## Gate A (Must): Withdrawal payout invariant

Command used:

```bash
npm run test:gmx-exploit-search:ava -- --grep "executeWithdrawal"
```

Latest result:

- Default run outcome: `0 passing, 1 pending`
- Skip condition in test: avalanche + `GMX_ALLOW_AVA_ORACLE_EXECUTE !== "1"` (explicit guard in the spec)
- Unblocked run command:

```bash
$env:GMX_ALLOW_AVA_ORACLE_EXECUTE='1' ; npm run test:gmx-exploit-search:ava -- --grep "executeWithdrawal"
```

- Unblocked run outcome: `1 passing`
- Interpretation: Gate A can be executed and currently passes when oracle execution is explicitly enabled.

## Gate B (Must): executeOrder market-increase path

Command used:

```bash
$env:GMX_ALLOW_AVA_ORACLE_EXECUTE='1' ; npm run test:gmx-exploit-search:ava -- --grep "executeOrder|market-increase"
```

Latest result:

- Test discovered: `Order Fee Escape [WAVAX/USDC] -> executeOrder: market-increase position is opened (deterministic)`
- Outcome: `1 passing`
- Interpretation: Gate B is currently passing when Avalanche oracle execute skip guard is disabled.

## Gate C (Must): one Oracle source diff

Command used (initial check):

```bash
git diff --no-index -- outputs/oracle-store-arb.sol outputs/oracle-store-ava.sol
```

Follow-up command (scripted fetch with proxy-aware parsing):

```bash
node scripts/fetch-verified-source.js
```

Latest result:

- `outputs/oracle-store-meta.json` and `outputs/oracle-store-diff.txt` now generated.
- Avalanche fetch succeeded (`OracleStore`, source length `52090`).
- Arbitrum fetch failed due deprecated explorer endpoint / missing V2 key (`source length 0`).
- Interpretation: Gate C remains partially open until Arbitrum source is fetched using supported V2 API credentials.

## Environment Flags Required For Avalanche Tests

| Flag | Value | Effect | Required For |
|---|---|---|---|
| `GMX_ALLOW_AVA_ORACLE_EXECUTE` | `1` | Disables avalanche-only skip guard in deterministic execute tests | Gate A, Gate B |

What this flag bypasses:

- In [test/gmx-invariants/withdrawalLifecycle.spec.ts](test/gmx-invariants/withdrawalLifecycle.spec.ts#L79) and [test/gmx-invariants/withdrawalLifecycle.spec.ts](test/gmx-invariants/withdrawalLifecycle.spec.ts#L116), tests call `this.skip()` when chain is avalanche and `GMX_ALLOW_AVA_ORACLE_EXECUTE !== "1"`.
- In [test/gmx-invariants/orderFeeEscape.spec.ts](test/gmx-invariants/orderFeeEscape.spec.ts#L130), the deterministic executeOrder test uses the same guard.
- This bypasses test-level skip logic only; it does not alter protocol role checks or contract accounting logic.

## Gate D (Nice, but high value): Slither reentrancy/delegatecall triage

Executed full project run (after installing `gmx-synthetics` deps and local slither):

```bash
c:/Users/servi/gmx-audit/.venv/Scripts/slither.exe gmx-synthetics \
  --compile-force-framework hardhat \
  --filter-paths "node_modules|test|lib/forge-std" \
  --detect reentrancy-eth,reentrancy-no-eth,reentrancy-benign,reentrancy-events,controlled-delegatecall,arbitrary-send-erc20,arbitrary-send-erc20-permit,arbitrary-send-eth \
  --json outputs/slither-gmx-synthetics.json
```

Summary extracted from JSON:

- Total findings: `42`
- Detector counts:
  - `reentrancy-benign`: 3
  - `arbitrary-send-eth`: 5
  - `arbitrary-send-erc20`: 6
  - `reentrancy-events`: 27
  - `reentrancy-no-eth`: 1
- Scoped hits:
  - GLV-related: 2
  - Oracle-related: 10
  - ExchangeRouter.sol direct hits: 0

Scoped examples:

- GLV:
  - `reentrancy-events` at `contracts/exchange/GlvDepositHandler.sol:53`
  - `reentrancy-events` at `contracts/exchange/GlvWithdrawalHandler.sol:54`
- Oracle:
  - `reentrancy-benign` at `contracts/oracle/Oracle.sol:112`
  - `reentrancy-benign` at `contracts/oracle/Oracle.sol:183`
  - `reentrancy-benign` at `contracts/oracle/Oracle.sol:104`

Exploitability triage for high-signal `arbitrary-send-*`:

- `contracts/multichain/LayerZeroProvider.sol:191` (`bridgeOut`): `onlyController`; requires privileged controller flow.
- `contracts/contributor/ContributorHandler.sol:99` (`sendPayments`): `onlyContributorDistributor`; permissioned distribution role.
- `contracts/router/Router.sol:26` (`pluginTransfer`): `onlyRouterPlugin`; called through approved plugin paths.
- `contracts/market/PositionImpactPoolUtils.sol:153` (`reduceLentAmount`): library call site is `ConfigTimelockController.reduceLentImpactAmount`, gated by `onlySelf` execution.
- `contracts/fee/FeeDistributor.sol:457` (`_bridgeGmx`) and `contracts/fee/FeeDistributor.sol:542` (`_finalizeWntForTreasury`): internal distribution flow; entrypoints are keeper/reader gated.

Router plugin role governance note:

- `onlyRouterPlugin` resolves via `RoleStore.hasRole(..., Role.ROUTER_PLUGIN)` in [gmx-synthetics/contracts/role/RoleModule.sol](gmx-synthetics/contracts/role/RoleModule.sol#L91).
- Role grants are admin-only in [gmx-synthetics/contracts/role/RoleStore.sol](gmx-synthetics/contracts/role/RoleStore.sol#L44).
- Timelock role grant signaling path exists in [gmx-synthetics/contracts/config/TimelockConfig.sol](gmx-synthetics/contracts/config/TimelockConfig.sol#L52).

Oracle detector mix (important):

- Oracle-scoped findings are only `reentrancy-benign`, `reentrancy-events`, and `reentrancy-no-eth`.
- No Oracle-scoped `arbitrary-send-*` findings in this run.

## Minimal Ship Checklist

1. Keep Gate A/B commands pinned with `GMX_ALLOW_AVA_ORACLE_EXECUTE=1` for deterministic avalanche execution.
2. Complete Gate C by fetching Arbitrum OracleStore source through a supported V2 API key path.
3. Confirm proxy/implementation mapping for compared Oracle addresses after Arbitrum fetch is restored.
4. Continue triage on any remaining non-permissioned high-signal static findings.

## Notes

- `outputs/` is ignored by git in this workspace. Keep canonical runbook and status in tracked `docs/` files.
- Do not claim "clean audit" until Gates A/B are non-pending and implementation-level oracle comparison is confirmed.