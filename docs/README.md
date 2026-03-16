# GMX Audit Execution Entry

Use only two docs for current execution state:

1. `docs/README.md` (this file): single entrypoint
2. `docs/PHASE4.md`: Phase 4 gates, commands, and latest run evidence

## Current Gate Status

- Gate A (`executeWithdrawal: payout <= fair share`): `PASS` when `GMX_ALLOW_AVA_ORACLE_EXECUTE=1`; default run remains pending by design.
- Gate B (`executeOrder` critical path): not run in this pass.
- Gate C (one Oracle source diff): `NOT VALIDATED` in this pass; local source snapshot files were empty.
- Gate D (Slither reentrancy/delegatecall pass): completed and triaged; highest-signal findings are access-control constrained.

## Evidence Files

- `outputs/slither-gmx-synthetics.json`
- `outputs/oracle-store-arb.sol`
- `outputs/oracle-store-ava.sol`
- `outputs/findings.md`
- `outputs/chain_diff.md`

Open `docs/PHASE4.md` to continue execution.