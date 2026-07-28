# Weekly HackenProof Watch

Generated: 2026-07-28T18:39:00.787759+00:00

## Shortlist (scored)

| Program | Rep | Eco | Critical | Score | Priority | Status | New? | Web | Notes |
|---|---:|---|---:|---:|---|---|:--:|---|---|
| [ShapeShift](https://hackenproof.com/programs/shapeshift) | 50 | EVM | $10,000 | 6 | MEDIUM | CLOSED-NO-FINDING |  | skipped | public source, paid history; rFOX StakingV1 == audited, invariants hold. low max bounty. |
| [Whitechain Bridge](https://hackenproof.com/programs/whitechain-bridge) | 50 | EVM | $100,000 | 4 | LOW | CLOSED-NO-FINDING |  | skipped | centralized bridge; signature domain gap refuted by distinct relayers. |
| [SuperEarn Web & Smart Contracts](https://hackenproof.com/programs/superearn-web-and-smart-contracts) | ? | EVM | $30,000 | 4 | LOW | PAUSED-WATCH |  | skipped | PAUSED-WATCH, HIGH on reopening. Custom cross-chain vault/accounting (Kaia CooldownVault/OriginVault/BridgeAccountant <-> Ethereum RemoteVault); public source superearn-io/superearn-core-public; permissionless flows; direct fund-safety invariants (queue conservation, FIFO claims, decimal/aggregation, harvest P&L). Foundry-fork reproducible. Saturation HIGH (249 subs, $2.8k paid, 3 Certik reviews). Strategy: DEPLOYMENT-DIFF FIRST (published repo vs audited commits vs deployed proxies vs post-pause upgrades). Rep requirement UNCONFIRMED — confirm <=80. Do NOT assess while paused / no submission channel. |
| [RISC Zero Blockchain Verifiers](https://hackenproof.com/programs/risc-zero-blockchain-verifiers) | 50 | EVM | $150,000 | 3 | LOW | PAUSED |  | skipped | high-value verifier scope, toolchain-heavy; contract surface clean/audit-saturated. paused-toolchain-gate. |
| [Cronos Smart Contracts](https://hackenproof.com/programs/cronos-smart-contracts) | 50 | EVM | $200,000 | 3 | LOW | CLOSED-NO-FINDING |  | skipped | saturated ($0 paid, 146 subs); Fulcrom/Tectonic/Veno faithful forks or privileged. low EV unless scope changes. |

## Changes Since Last Run

No changes detected.

## Alerts (new HIGH/MEDIUM, actionable)

None. No fresh candidate clears the bar this week — hold active hunting; keep watching. Add newly launched ≤80-rep smart-contract programs to `PROGRAMS` with `status: NEW`.
