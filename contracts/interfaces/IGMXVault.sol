// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IGMXVault {
    function isInitialized() external view returns (bool);
    function whitelistedTokens(address token) external view returns (bool);
    function poolAmounts(address token) external view returns (uint256);
    function reservedAmounts(address token) external view returns (uint256);
    function usdgAmounts(address token) external view returns (uint256);
    function guaranteedUsd(address token) external view returns (uint256);
    function feeReserves(address token) external view returns (uint256);

    function getMaxPrice(address token) external view returns (uint256);
    function getMinPrice(address token) external view returns (uint256);
    function getRedemptionAmount(address token, uint256 usdgAmount) external view returns (uint256);

    function getPosition(
        address account,
        address collateralToken,
        address indexToken,
        bool isLong
    )
        external
        view
        returns (
            uint256 size,
            uint256 collateral,
            uint256 averagePrice,
            uint256 entryFundingRate,
            uint256 reserveAmount,
            int256 realisedPnl,
            uint256 lastIncreasedTime
        );
}
