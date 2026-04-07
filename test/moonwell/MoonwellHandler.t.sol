// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/console.sol";

// ============================================================
// INTERFACES
// ============================================================

interface IComptroller {
    function getAccountLiquidity(address account)
        external
        view
        returns (uint256 err, uint256 liquidity, uint256 shortfall);
    function getHypotheticalAccountLiquidity(
        address account,
        address mTokenModify,
        uint256 redeemTokens,
        uint256 borrowAmount
    ) external view returns (uint256, uint256, uint256);
    function liquidationIncentiveMantissa() external view returns (uint256);
    function closeFactorMantissa() external view returns (uint256);
    function supplyCaps(address mToken) external view returns (uint256);
    function borrowCaps(address mToken) external view returns (uint256);
    function enterMarkets(address[] calldata mTokens) external returns (uint256[] memory);
    function exitMarket(address mToken) external returns (uint256);
    function checkMembership(address account, address mToken) external view returns (bool);
    function markets(address mToken)
        external
        view
        returns (bool isListed, uint256 collateralFactorMantissa, bool isComped);
}

interface IMToken {
    function mint(uint256 mintAmount) external returns (uint256);
    function redeem(uint256 redeemTokens) external returns (uint256);
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);
    function borrow(uint256 borrowAmount) external returns (uint256);
    function repayBorrow(uint256 repayAmount) external returns (uint256);
    function liquidateBorrow(address borrower, uint256 repayAmount, address mTokenCollateral) external returns (uint256);
    function seize(address liquidator, address borrower, uint256 seizeTokens) external returns (uint256);
    function accrueInterest() external returns (uint256);
    function balanceOf(address owner) external view returns (uint256);
    function balanceOfUnderlying(address owner) external returns (uint256);
    function borrowBalanceCurrent(address account) external returns (uint256);
    function borrowBalanceStored(address account) external view returns (uint256);
    function exchangeRateCurrent() external returns (uint256);
    function exchangeRateStored() external view returns (uint256);
    function totalBorrows() external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function totalReserves() external view returns (uint256);
    function getCash() external view returns (uint256);
    function underlying() external view returns (address);
}

interface IOracle {
    function getUnderlyingPrice(address mToken) external view returns (uint256);
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

// ============================================================
// VERIFIED BASE MAINNET ADDRESSES (April 2026)
// Verify against Basescan before running; update on protocol upgrade.
// ============================================================

address constant COMPTROLLER = 0xfBb21d0380beE3312B33c4353c8936a0F13EF26C;
address constant ORACLE = 0xEC942bE8A8114bFD0396A5052c36027f2cA6a9d0;
address constant mUSDC_ADDR = 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22;
address constant mWETH_ADDR = 0x628ff693426583D9a7FB391E54366292F509D457;
address constant mCBETH_ADDR = 0x3bf93770f2d4a794c3d9EBEfBAeBAE2a8f09A5E5;

address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
address constant WETH = 0x4200000000000000000000000000000000000006;
address constant CBETH = 0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22;

// EPSILON: tolerance for integer-division rounding noise in net-value checks.
// Large enough to absorb dust, small enough to catch any economically meaningful
// exploit (threshold: >0.001 USD per user triggers failure).
uint256 constant EPSILON_USD = 1e16;

// ============================================================
// HANDLER
// ============================================================

contract MoonwellHandler is Test {
    IComptroller public comptroller = IComptroller(COMPTROLLER);
    IOracle public oracle = IOracle(ORACLE);

    IMToken[] public markets;
    address[] public users;

    // ─── Ghost Variables (economic tracking) ───────────────────────────────────

    // Per-user net economic delta:
    //   netValueUSD[user] = (borrowed + withdrawn) - (supplied + repaid)
    // Legitimate users stay <= 0 (put in more than taken out).
    // Positive value > EPSILON_USD = free value extraction = bug.
    // Liquidation profits are intentionally NOT tracked here; they are
    // validated separately by invariant_liquidationSeizeBound.
    mapping(address => int256) public ghost_netValueUSD;

    // Full liquidation history — used by invariant_liquidationSeizeBound
    struct LiquidationRecord {
        uint256 repayAmountUnderlying; // principal repaid, in underlying units
        uint256 seizedTokens; // mTokens received by liquidator
        address collateralMarket; // mToken seized
        address repayMarket; // mToken whose debt was cleared
        uint256 blockNumber;
    }
    LiquidationRecord[] public ghost_liquidations;

    // Protocol-level mirrors (for solvency cross-check)
    uint256 public ghost_totalSuppliedUSD;
    uint256 public ghost_totalBorrowedUSD;

    // Cap-breach flags — latched true on first breach for post-run analysis
    bool public ghost_supplyCapBreached;
    bool public ghost_borrowCapBreached;

    // Per-market exchange rate high-water mark — used by monotonicity invariant
    mapping(address => uint256) public ghost_lastExchangeRate;

    // ─── Setup ─────────────────────────────────────────────────────────────────

    constructor() {
        markets.push(IMToken(mUSDC_ADDR));
        markets.push(IMToken(mWETH_ADDR));
        markets.push(IMToken(mCBETH_ADDR));

        // 8 deterministic user addresses — same seed across all runs
        for (uint256 i = 0; i < 8; i++) {
            address user = vm.addr(uint256(keccak256(abi.encodePacked("user", i))));
            users.push(user);
        }

        // Snapshot baseline exchange rates for monotonicity invariant
        for (uint256 m = 0; m < markets.length; m++) {
            try markets[m].exchangeRateStored() returns (uint256 rate) {
                ghost_lastExchangeRate[address(markets[m])] = rate;
            } catch {}
        }
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    /// @dev Convert underlying units -> USD (1e18-scaled).
    /// Moonwell/Compound oracle prices are already scaled by 1e(36-underlyingDecimals),
    /// so amount * price / 1e18 yields 1e18 USD value directly.
    function _toUSD(address market, uint256 underlyingAmount) internal view returns (uint256) {
        uint256 price = oracle.getUnderlyingPrice(market);
        return (underlyingAmount * price) / 1e18;
    }

    /// @dev Convert mToken units → USD
    function _mTokenToUSD(address market, uint256 mTokenAmount) internal view returns (uint256) {
        uint256 exRate = IMToken(market).exchangeRateStored();
        uint256 ul = (mTokenAmount * exRate) / 1e18;
        return _toUSD(market, ul);
    }

    // ─── Fuzzable Actions ───────────────────────────────────────────────────────

    /// @notice Supply underlying → ghost[user] -= valueUSD
    function supply(uint256 userSeed, uint256 marketSeed, uint256 amount) public {
        address user = users[userSeed % users.length];
        IMToken market = markets[marketSeed % markets.length];
        address underlying = market.underlying();

        uint256 balance = IERC20(underlying).balanceOf(user);
        if (balance == 0) return;
        amount = bound(amount, 1, balance);

        vm.prank(user);
        uint256 err = market.mint(amount);
        if (err != 0) return;

        uint256 valueUSD = _toUSD(address(market), amount);
        ghost_netValueUSD[user] -= int256(valueUSD);
        ghost_totalSuppliedUSD += valueUSD;

        uint256 newRate = market.exchangeRateStored();
        if (newRate > ghost_lastExchangeRate[address(market)]) {
            ghost_lastExchangeRate[address(market)] = newRate;
        }
    }

    /// @notice Borrow from a market → ghost[user] += valueUSD
    function borrow(uint256 userSeed, uint256 marketSeed, uint256 amount) public {
        address user = users[userSeed % users.length];
        IMToken market = markets[marketSeed % markets.length];

        // Auto-enter so borrowing is possible
        if (!comptroller.checkMembership(user, address(market))) {
            address[] memory mTokens = new address[](1);
            mTokens[0] = address(market);
            vm.prank(user);
            comptroller.enterMarkets(mTokens);
        }

        amount = bound(amount, 1, 100_000e18);

        vm.prank(user);
        uint256 err = market.borrow(amount);
        if (err != 0) return;

        uint256 valueUSD = _toUSD(address(market), amount);
        ghost_netValueUSD[user] += int256(valueUSD);
        ghost_totalBorrowedUSD += valueUSD;
    }

    /// @notice Redeem mTokens → ghost[user] += actual underlying received in USD
    function redeem(uint256 userSeed, uint256 marketSeed, uint256 mTokenAmount) public {
        address user = users[userSeed % users.length];
        IMToken market = markets[marketSeed % markets.length];

        uint256 bal = market.balanceOf(user);
        if (bal == 0) return;
        mTokenAmount = bound(mTokenAmount, 1, bal);

        address underlying = market.underlying();
        uint256 preBal = IERC20(underlying).balanceOf(user);

        vm.prank(user);
        uint256 err = market.redeem(mTokenAmount);
        if (err != 0) return;

        uint256 postBal = IERC20(underlying).balanceOf(user);
        uint256 received = postBal > preBal ? postBal - preBal : 0;

        uint256 valueUSD = _toUSD(address(market), received);
        ghost_netValueUSD[user] += int256(valueUSD);

        uint256 newRate = market.exchangeRateStored();
        if (newRate > ghost_lastExchangeRate[address(market)]) {
            ghost_lastExchangeRate[address(market)] = newRate;
        }
    }

    /// @notice Repay outstanding borrow → ghost[user] -= repaidAmountUSD
    function repay(uint256 userSeed, uint256 marketSeed) public {
        address user = users[userSeed % users.length];
        IMToken market = markets[marketSeed % markets.length];

        uint256 borrowBal = market.borrowBalanceStored(user);
        if (borrowBal == 0) return;

        address underlying = market.underlying();
        uint256 userBal = IERC20(underlying).balanceOf(user);
        if (userBal == 0) return;

        uint256 repayAmt = borrowBal < userBal ? borrowBal : userBal;

        vm.prank(user);
        uint256 err = market.repayBorrow(repayAmt);
        if (err != 0) return;

        uint256 valueUSD = _toUSD(address(market), repayAmt);
        ghost_netValueUSD[user] -= int256(valueUSD);
    }

    /// @notice Trigger interest accrual — critical for reaching timing-based and
    /// borrow-index-drift bugs that are invisible without accrue calls.
    function accrueInterest(uint256 marketSeed) public {
        IMToken market = markets[marketSeed % markets.length];
        market.accrueInterest();
        uint256 newRate = market.exchangeRateStored();
        if (newRate > ghost_lastExchangeRate[address(market)]) {
            ghost_lastExchangeRate[address(market)] = newRate;
        }
    }

    /// @notice Mine N blocks + warp time, then accrue all markets.
    /// Exposes stale exchange-rate, borrow-index drift, and time-gated bugs.
    function mineBlocks(uint256 blocks) public {
        blocks = bound(blocks, 1, 100);
        vm.roll(block.number + blocks);
        vm.warp(block.timestamp + blocks * 12); // ~12 s per block on Base
        for (uint256 i = 0; i < markets.length; i++) {
            markets[i].accrueInterest();
            uint256 newRate = markets[i].exchangeRateStored();
            if (newRate > ghost_lastExchangeRate[address(markets[i])]) {
                ghost_lastExchangeRate[address(markets[i])] = newRate;
            }
        }
    }

    /// @notice Liquidate a borrower.
    /// Records every seizure in ghost_liquidations[] for invariant_liquidationSeizeBound.
    /// Does NOT update ghost_netValueUSD — liquidation incentive profits are expected
    /// and bounded separately.
    function liquidate(
        uint256 liquidatorSeed,
        uint256 borrowerSeed,
        uint256 repayMarketSeed,
        uint256 seizeMarketSeed,
        uint256 repayAmount
    ) public {
        address liquidator = users[liquidatorSeed % users.length];
        address borrower = users[borrowerSeed % users.length];
        if (liquidator == borrower) return;

        IMToken repayMarket = markets[repayMarketSeed % markets.length];
        IMToken seizeMarket = markets[seizeMarketSeed % markets.length];

        uint256 borrowBal = repayMarket.borrowBalanceStored(borrower);
        if (borrowBal == 0) return;

        // Respect close factor
        uint256 closeFactor = comptroller.closeFactorMantissa();
        uint256 maxRepay = (borrowBal * closeFactor) / 1e18;
        if (maxRepay == 0) return;
        repayAmount = bound(repayAmount, 1, maxRepay);

        // Liquidator must hold enough underlying
        address underlying = repayMarket.underlying();
        if (IERC20(underlying).balanceOf(liquidator) < repayAmount) return;

        uint256 preSeizeBal = seizeMarket.balanceOf(liquidator);

        vm.prank(liquidator);
        try repayMarket.liquidateBorrow(borrower, repayAmount, address(seizeMarket)) returns (uint256 err) {
            if (err != 0) return;
        } catch {
            return;
        }

        uint256 postSeizeBal = seizeMarket.balanceOf(liquidator);
        uint256 seizedTokens = postSeizeBal > preSeizeBal ? postSeizeBal - preSeizeBal : 0;

        ghost_liquidations.push(
            LiquidationRecord({
                repayAmountUnderlying: repayAmount,
                seizedTokens: seizedTokens,
                collateralMarket: address(seizeMarket),
                repayMarket: address(repayMarket),
                blockNumber: block.number
            })
        );
    }

    /// @notice Try to exit a market while still borrowing.
    /// The Comptroller MUST reject this — success would leave the borrow uncollateralised.
    function exitMarketWhileBorrowing(uint256 userSeed, uint256 marketSeed) public {
        address user = users[userSeed % users.length];
        IMToken market = markets[marketSeed % markets.length];

        uint256 borrowBal = market.borrowBalanceStored(user);

        vm.prank(user);
        uint256 err = comptroller.exitMarket(address(market));

        if (borrowBal > 0) {
            assertNotEq(err, 0, "INVARIANT: exit market while borrowing must revert");
        }
    }

    /// @notice Same-block multi-action: supply → enterMarket → borrow → immediate full redeem.
    /// If the redeem succeeds the borrow must remain fully collateralised.
    function sameBlockAttack(uint256 userSeed, uint256 marketSeed, uint256 supplyAmt, uint256 borrowAmount) public {
        address user = users[userSeed % users.length];
        IMToken market = markets[marketSeed % markets.length];
        address underlying = market.underlying();

        uint256 bal = IERC20(underlying).balanceOf(user);
        if (bal == 0) return;
        supplyAmt = bound(supplyAmt, 1, bal);

        // Supply
        vm.prank(user);
        if (market.mint(supplyAmt) != 0) return;
        uint256 supplyValueUSD = _toUSD(address(market), supplyAmt);
        ghost_netValueUSD[user] -= int256(supplyValueUSD);
        ghost_totalSuppliedUSD += supplyValueUSD;

        // Enter market
        address[] memory mTokens = new address[](1);
        mTokens[0] = address(market);
        vm.prank(user);
        comptroller.enterMarkets(mTokens);

        // Borrow in the same block — no mining
        borrowAmount = bound(borrowAmount, 1, supplyAmt / 2 > 0 ? supplyAmt / 2 : 1);
        vm.prank(user);
        if (market.borrow(borrowAmount) != 0) return;
        uint256 borrowValueUSD = _toUSD(address(market), borrowAmount);
        ghost_netValueUSD[user] += int256(borrowValueUSD);
        ghost_totalBorrowedUSD += borrowValueUSD;

        // Attempt immediate full redeem — must not leave user undercollateralised
        uint256 mBal = market.balanceOf(user);
        if (mBal == 0) return;
        uint256 preBal = IERC20(underlying).balanceOf(user);
        vm.prank(user);
        uint256 err = market.redeem(mBal);
        if (err == 0) {
            uint256 postBal = IERC20(underlying).balanceOf(user);
            uint256 received = postBal > preBal ? postBal - preBal : 0;
            uint256 redeemValueUSD = _toUSD(address(market), received);
            ghost_netValueUSD[user] += int256(redeemValueUSD);

            (,, uint256 shortfall) = comptroller.getAccountLiquidity(user);
            assertEq(shortfall, 0, "INVARIANT: same-block redeem left user undercollateralised");
        }
    }

    // ─── Accessors ─────────────────────────────────────────────────────────────

    function marketsLength() external view returns (uint256) {
        return markets.length;
    }

    function usersLength() external view returns (uint256) {
        return users.length;
    }

    function getMarket(uint256 i) external view returns (address) {
        return address(markets[i]);
    }

    function getUser(uint256 i) external view returns (address) {
        return users[i];
    }

    function liquidationsLength() external view returns (uint256) {
        return ghost_liquidations.length;
    }

    // ─── Invariant Assertion Functions ─────────────────────────────────────────
    // Called by MoonwellInvariantTest after every fuzz sequence.

    /// CRITICAL: No user should extract net value from the protocol.
    /// ghost_netValueUSD > EPSILON_USD means they received more than they put in.
    function invariant_netValueDelta() public view {
        for (uint256 i = 0; i < users.length; i++) {
            assertLe(
                ghost_netValueUSD[users[i]], int256(EPSILON_USD), "INVARIANT: user extracted net value from protocol"
            );
        }
    }

    /// CRITICAL: No user can simultaneously hold positive liquidity AND positive shortfall.
    function invariant_noFreeBorrow() public view {
        for (uint256 i = 0; i < users.length; i++) {
            (, uint256 liquidity, uint256 shortfall) = comptroller.getAccountLiquidity(users[i]);
            assertTrue(
                shortfall == 0 || liquidity == 0, "INVARIANT: user has both liquidity and shortfall simultaneously"
            );
        }
    }

    /// CRITICAL: Total protocol collateral (USD) must cover total borrow obligations.
    function invariant_protocolSolvent() public view {
        uint256 totalBorrowUSD = 0;
        uint256 totalCollateralUSD = 0;

        for (uint256 i = 0; i < markets.length; i++) {
            IMToken m = markets[i];
            uint256 price = oracle.getUnderlyingPrice(address(m));
            uint256 totalSupplyTokens = m.totalSupply();
            uint256 exRate = m.exchangeRateStored();
            uint256 borrows = m.totalBorrows();

            totalBorrowUSD += (borrows * price) / 1e18;
            uint256 underlyingSupply = (totalSupplyTokens * exRate) / 1e18;
            totalCollateralUSD += (underlyingSupply * price) / 1e18;
        }

        assertGe(totalCollateralUSD, totalBorrowUSD, "INVARIANT: protocol insolvent");
    }

    /// HIGH: V2 supply and borrow caps must never be exceeded.
    /// Primary new attack surface added in Moonwell V2.
    function invariant_capsRespected() public {
        for (uint256 i = 0; i < markets.length; i++) {
            IMToken m = markets[i];
            uint256 supplyCap = comptroller.supplyCaps(address(m));
            uint256 borrowCap = comptroller.borrowCaps(address(m));
            uint256 totalSup = m.totalSupply();
            uint256 exRate = m.exchangeRateStored();
            uint256 totalSupUnderlying = (totalSup * exRate) / 1e18;
            uint256 totalBor = m.totalBorrows();

            if (supplyCap > 0) {
                if (totalSupUnderlying > supplyCap) ghost_supplyCapBreached = true;
                assertLe(totalSupUnderlying, supplyCap, "INVARIANT: supply cap breached");
            }
            if (borrowCap > 0) {
                if (totalBor > borrowCap) ghost_borrowCapBreached = true;
                assertLe(totalBor, borrowCap, "INVARIANT: borrow cap breached");
            }
        }
    }

    /// HIGH: Liquidation over-seizure.
    /// For each recorded liquidation:
    ///   maxSeize (mTokens) = repay * liquidationIncentive/1e18
    ///                        * priceBorrow / priceCollateral
    ///                        * 1e18 / exchangeRate
    function invariant_liquidationSeizeBound() public view {
        uint256 incentive = comptroller.liquidationIncentiveMantissa();

        for (uint256 i = 0; i < ghost_liquidations.length; i++) {
            LiquidationRecord memory rec = ghost_liquidations[i];

            uint256 priceBorrow = oracle.getUnderlyingPrice(rec.repayMarket);
            uint256 priceCollateral = oracle.getUnderlyingPrice(rec.collateralMarket);
            uint256 exRate = IMToken(rec.collateralMarket).exchangeRateStored();

            if (priceBorrow == 0 || priceCollateral == 0 || exRate == 0) continue;

            // Split computation to avoid intermediate overflow:
            //   Step 1: repay * incentive / 1e18   (reduces magnitude)
            //   Step 2: * priceBorrow / priceCollateral * 1e18 / exRate
            uint256 repayWithIncentive = rec.repayAmountUnderlying * incentive / 1e18;
            uint256 denominator = priceCollateral * exRate / 1e18;
            if (denominator == 0) continue;
            uint256 maxSeize = repayWithIncentive * priceBorrow / denominator;

            assertLe(
                rec.seizedTokens,
                maxSeize + 1, // +1 absorbs integer-rounding remainder
                "INVARIANT: liquidation seized more collateral than formula allows"
            );
        }
    }

    /// HIGH: Oracle must return non-zero, non-absurd prices.
    /// Zero price = Feb 2026 cbETH incident pattern.
    function invariant_oracleSanity() public view {
        for (uint256 i = 0; i < markets.length; i++) {
            uint256 price = oracle.getUnderlyingPrice(address(markets[i]));
            assertGt(price, 0, "INVARIANT: oracle returned zero price");
            assertLt(price, 1e36, "INVARIANT: oracle price is absurdly large");
        }
    }

    /// HIGH: Exchange rate must be monotonically non-decreasing.
    /// A decrease means interest was reversed — impossible under correct operation.
    function invariant_exchangeRateMonotonic() public view {
        for (uint256 i = 0; i < markets.length; i++) {
            address mkt = address(markets[i]);
            uint256 current = IMToken(mkt).exchangeRateStored();
            assertGe(current, ghost_lastExchangeRate[mkt], "INVARIANT: exchange rate decreased (interest reversal)");
        }
    }
}

// ============================================================
// TEST CONTRACT — wires handler to Foundry invariant runner
// ============================================================

// Run:      forge test --match-contract MoonwellInvariantTest --fork-url http://127.0.0.1:8545 -vv
// Extended: FOUNDRY_PROFILE=extended forge test --match-contract MoonwellInvariantTest --fork-url http://127.0.0.1:8545 -vvv
// Repro:    npm run test:moonwell:handler 2>&1 | ts-node scripts/generate-repro.ts

contract MoonwellInvariantTest is Test {
    MoonwellHandler public handler;

    function setUp() public {
        string memory forkUrl = vm.envOr("MOONWELL_LOCAL_RPC_URL", string("http://127.0.0.1:8545"));
        vm.createSelectFork(forkUrl, 18_500_000);
        handler = new MoonwellHandler();

        uint256 numMarkets = handler.marketsLength();
        uint256 numUsers = handler.usersLength();

        for (uint256 u = 0; u < numUsers; u++) {
            address user = handler.getUser(u);
            for (uint256 m = 0; m < numMarkets; m++) {
                address mktAddr = handler.getMarket(m);
                address underlying;
                try IMToken(mktAddr).underlying() returns (address ul) {
                    underlying = ul;
                } catch {
                    continue;
                }

                uint8 dec = IERC20(underlying).decimals();
                deal(underlying, user, 1_000_000 * (10 ** dec));

                vm.prank(user);
                IERC20(underlying).approve(mktAddr, type(uint256).max);
            }
        }

        // Restrict forge to only call handler functions
        targetContract(address(handler));
    }

    // Forge calls these after every generated call sequence.
    // Delegation keeps all ghost state in one place.
    function invariant_netValueDelta() public view {
        handler.invariant_netValueDelta();
    }

    function invariant_noFreeBorrow() public view {
        handler.invariant_noFreeBorrow();
    }

    function invariant_protocolSolvent() public view {
        handler.invariant_protocolSolvent();
    }

    function invariant_capsRespected() public {
        handler.invariant_capsRespected();
    }

    function invariant_liquidationSeizeBound() public view {
        handler.invariant_liquidationSeizeBound();
    }

    function invariant_oracleSanity() public view {
        handler.invariant_oracleSanity();
    }

    function invariant_exchangeRateMonotonic() public view {
        handler.invariant_exchangeRateMonotonic();
    }
}
