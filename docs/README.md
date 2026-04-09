# GMX Audit Execution Entry

Use only two docs for current execution state:

1. `docs/README.md` (this file): single entrypoint
2. `docs/PHASE4.md`: Phase 4 gates, commands, and latest run evidence

## Current Gate Status

- Gate A (`executeWithdrawal: payout <= fair share`): `PASS` when `GMX_ALLOW_AVA_ORACLE_EXECUTE=1`; default run remains pending by design.
- Gate B (`executeOrder` critical path): `PASS` when `GMX_ALLOW_AVA_ORACLE_EXECUTE=1`.
- Gate C (one Oracle source diff): `PARTIAL`; Avalanche source fetched, Arbitrum fetch blocked by deprecated endpoint / missing V2 key.
- Gate D (Slither reentrancy/delegatecall pass): completed and triaged; highest-signal findings are access-control constrained.
- Real exploit probe (unauthorized calls): `PASS`; OrderHandler/WithdrawalHandler privileged execute paths revert for non-privileged signer.

## Coverage Highlights

- Legion sealed-bid auction capital-conservation finding: [../README.md#legion-sealed-bid-auction](../README.md#legion-sealed-bid-auction).

## Evidence Files

- `outputs/slither-gmx-synthetics.json`
- `outputs/oracle-store-arb.sol`
- `outputs/oracle-store-ava.sol`
- `outputs/oracle-store-meta.json`
- `outputs/oracle-store-diff.txt`
- `outputs/findings.md`
- `outputs/chain_diff.md`

Open `docs/PHASE4.md` to continue execution.