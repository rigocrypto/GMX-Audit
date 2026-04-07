// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

/**
 * AUTO-GENERATED REPRO SCRIPT
 * Generated: 2026-04-07T02:13:37.070Z
 * Failing invariant: invariant_netValueDelta
 * Forge seed: 0x0
 *
 * HOW TO RUN:
 *   forge test --match-test test_repro --fork-url $BASE_RPC_URL -vvvv
 */

import "forge-std/Test.sol";
import "./moonwell/MoonwellHandler.t.sol";

contract MoonwellRepro is Test {
    MoonwellHandler public handler;

    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_RPC_URL"), 18_500_000);
        handler = new MoonwellHandler();
    }

    function test_repro() public {
        // Failing call sequence (0 steps)
        // Seed: 0x0

        // No sequence captured. Re-run with -vv or higher.

        handler.invariant_netValueDelta();
    }
}

/**
 * RAW FORGE OUTPUT:
 *
 * 
 * > gmx-audit@1.0.0 test:moonwell:handler
 * > dotenv -- forge test --match-contract MoonwellInvariantTest --fork-url base --fork-retries 12 --fork-retry-backoff 750 -vv
 * 
 * No files changed, compilation skipped
 * Warning: Failure from "C:/Users/servi/gmx-audit/cache/invariant/failures/MoonwellInvariantTest/invariant_netValueDelta" file was ignored because test contract bytecode has changed.
 * [2m2026-04-07T02:13:30.187841Z[0m [31mERROR[0m [2msharedbackend[0m[2m:[0m Failed to send/recv `basic` [3merr[0m[2m=[0mfailed to get account for 0x000000000000000000000000000000000000159A: Max retries exceeded HTTP error 429 with empty body [3maddress[0m[2m=[0m0x000000000000000000000000000000000000159A
 * [2m2026-04-07T02:13:35.939262Z[0m [31mERROR[0m [2msharedbackend[0m[2m:[0m Failed to send/recv `basic` [3merr[0m[2m=[0mfailed to get account for 0x0000000000000000000000000000000000001AB8: Max retries exceeded HTTP error 429 with empty body [3maddress[0m[2m=[0m0x0000000000000000000000000000000000001AB8
 * [2m2026-04-07T02:13:35.939265Z[0m [31mERROR[0m [2msharedbackend[0m[2m:[0m Failed to send/recv `basic` [3merr[0m[2m=[0mfailed to get account for 0x0000000000000000000000000000000000001AB8: Max retries exceeded HTTP error 429 with empty body [3maddress[0m[2m=[0m0x0000000000000000000000000000000000001AB8
 * [2m2026-04-07T02:13:35.970755Z[0m [31mERROR[0m [2msharedbackend[0m[2m:[0m Failed to send/recv `basic` [3merr[0m[2m=[0mfailed to get account for 0x00000000000000000000000000000000000018Da: Max retries exceeded HTTP error 429 with empty body [3maddress[0m[2m=[0m0x00000000000000000000000000000000000018Da
 * [2m2026-04-07T02:13:36.107540Z[0m [31mERROR[0m [2msharedbackend[0m[2m:[0m Failed to send/recv `basic` [3merr[0m[2m=[0mfailed to get account for 0x2136E9ad1AAF6C49082d6A2359A6ce0147ea50AA: Max retries exceeded HTTP error 429 with empty body [3maddress[0m[2m=[0m0x2136E9ad1AAF6C49082d6A2359A6ce0147ea50AA
 * [2m2026-04-07T02:13:36.107619Z[0m [31mERROR[0m [2msharedbackend[0m[2m:[0m Failed to send/recv `basic` [3merr[0m[2m=[0mfailed to get account for 0xc1555853A3f293F812E1Ebd4303a5d6DF7173e6b: Max retries exceeded HTTP error 429 with empty body [3maddress[0m[2m=[0m0xc1555853A3f293F812E1Ebd4303a5d6DF7173e6b
 * [2m2026-04-07T02:13:37.007981Z[0m [31mERROR[0m [2msharedbackend[0m[2m:[0m Failed to send/recv `basic` [3merr[0m[2m=[0mfailed to get account for 0x0000000000000000000000000000000000000402: Max retries exceeded HTTP error 429 with empty body [3maddress[0m[2m=[0m0x0000000000000000000000000000000000000402
 * 
 * Ran 7 tests for test/moonwell/MoonwellHandler.t.sol:MoonwellInvariantTest
 * [FAIL: failed to set up invariant testing environment: Could not make raw evm call: EVM error; database error: failed to get account for 0x2136E9ad1AAF6C49082d6A2359A6ce0147ea50AA: Max retries exceeded HTTP error 429 with empty body] invariant_capsRespected() (runs: 0, calls: 0, reverts: 0)
 * [FAIL: failed to set up invariant testing environment: Could not make raw evm call: EVM error; database error: failed to get account for 0x0000000000000000000000000000000000001AB8: Max retries exceeded HTTP error 429 with empty body] invariant_exchangeRateMonotonic() (runs: 0, calls: 0, reverts: 0)
 * [FAIL: failed to set up invariant testing environment: Could not make raw evm call: EVM error; database error: failed to get account for 0x0000000000000000000000000000000000001AB8: Max retries exceeded HTTP error 429 with empty body] invariant_liquidationSeizeBound() (runs: 0, calls: 0, reverts: 0)
 * [FAIL: failed to set up invariant testing environment: Could not make raw evm call: EVM error; database error: failed to get account for 0x0000000000000000000000000000000000000402: Max retries exceeded HTTP error 429 with empty body] invariant_netValueDelta() (runs: 0, calls: 0, reverts: 0)
 * [FAIL: failed to set up invariant testing environment: Could not make raw evm call: EVM error; database error: failed to get account for 0xc1555853A3f293F812E1Ebd4303a5d6DF7173e6b: Max retries exceeded HTTP error 429 with empty body] invariant_noFreeBorrow() (runs: 0, calls: 0, reverts: 0)
 * [FAIL: failed to set up invariant testing environment: Could not make raw evm call: EVM error; database error: failed to get account for 0x00000000000000000000000000000000000018Da: Max retries exceeded HTTP error 429 with empty body] invariant_oracleSanity() (runs: 0, calls: 0, reverts: 0)
 * [FAIL: failed to set up invariant testing environment: Could not make raw evm call: EVM error; database error: failed to get account for 0x000000000000000000000000000000000000159A: Max retries exceeded HTTP error 429 with empty body] invariant_protocolSolvent() (runs: 0, calls: 0, reverts: 0)
 * Suite result: FAILED. 0 passed; 7 failed; 0 skipped; finished in 50.75s (337.09s CPU time)
 * 
 * Ran 1 test suite in 51.10s (50.75s CPU time): 0 tests passed, 7 failed, 0 skipped (7 total tests)
 * 
 * Failing tests:
 * Encountered 7 failing tests in test/moonwell/MoonwellHandler.t.sol:MoonwellInvariantTest
 * [FAIL: failed to set up invariant testing environment: Could not make raw evm call: EVM error; database error: failed to get account for 0x2136E9ad1AAF6C49082d6A2359A6ce0147ea50AA: Max retries exceeded HTTP error 429 with empty body] invariant_capsRespected() (runs: 0, calls: 0, reverts: 0)
 * [FAIL: failed to set up invariant testing environment: Could not make raw evm call: EVM error; database error: failed to get account for 0x0000000000000000000000000000000000001AB8: Max retries exceeded HTTP error 429 with empty body] invariant_exchangeRateMonotonic() (runs: 0, calls: 0, reverts: 0)
 * [FAIL: failed to set up invariant testing environment: Could not make raw evm call: EVM error; database error: failed to get account for 0x0000000000000000000000000000000000001AB8: Max retries exceeded HTTP error 429 with empty body] invariant_liquidationSeizeBound() (runs: 0, calls: 0, reverts: 0)
 * [FAIL: failed to set up invariant testing environment: Could not make raw evm call: EVM error; database error: failed to get account for 0x0000000000000000000000000000000000000402: Max retries exceeded HTTP error 429 with empty body] invariant_netValueDelta() (runs: 0, calls: 0, reverts: 0)
 * [FAIL: failed to set up invariant testing environment: Could not make raw evm call: EVM error; database error: failed to get account for 0xc1555853A3f293F812E1Ebd4303a5d6DF7173e6b: Max retries exceeded HTTP error 429 with empty body] invariant_noFreeBorrow() (runs: 0, calls: 0, reverts: 0)
 * [FAIL: failed to set up invariant testing environment: Could not make raw evm call: EVM error; database error: failed to get account for 0x00000000000000000000000000000000000018Da: Max retries exceeded HTTP error 429 with empty body] invariant_oracleSanity() (runs: 0, calls: 0, reverts: 0)
 * [FAIL: failed to set up invariant testing environment: Could not make raw evm call: EVM error; database error: failed to get account for 0x000000000000000000000000000000000000159A: Max retries exceeded HTTP error 429 with empty body] invariant_protocolSolvent() (runs: 0, calls: 0, reverts: 0)
 * 
 * Encountered a total of 7 failing tests, 0 tests succeeded
 * 
 * Tip: Run `forge test --rerun` to retry only the 7 failed tests
 */
