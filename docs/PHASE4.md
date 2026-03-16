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

Run next:

```bash
npm run test:gmx-exploit-search:ava -- --grep "executeOrder"
```

Pass condition:

- Target executeOrder critical test runs (not pending) and passes.

## Gate C (Must): one Oracle source diff

Command used:

```bash
git diff --no-index -- outputs/oracle-store-arb.sol outputs/oracle-store-ava.sol
```

Latest result:

- No textual diff output between saved Arb/Ava OracleStore snapshots.
- Sanity check: both local files were empty (`Length = 0`), so this comparison is not valid evidence.
- Interpretation: Gate C remains open; refetch source from explorer and compare implementation contracts (not proxies).

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

Oracle detector mix (important):

- Oracle-scoped findings are only `reentrancy-benign`, `reentrancy-events`, and `reentrancy-no-eth`.
- No Oracle-scoped `arbitrary-send-*` findings in this run.

## Minimal Ship Checklist

1. Clear Gate A or document concrete reason it cannot be executed on current fork.
2. Run Gate B command and classify pass/pending/fail.
3. For Gate C, confirm proxy/implementation mapping for the compared Oracle addresses.
4. Triage top Slither findings for exploitability (especially GLV handlers and Oracle flow).

## Notes

- `outputs/` is ignored by git in this workspace. Keep canonical runbook and status in tracked `docs/` files.
- Do not claim "clean audit" until Gates A/B are non-pending and implementation-level oracle comparison is confirmed.