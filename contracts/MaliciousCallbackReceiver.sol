// SPDX-License-Identifier: BUSL-1.1

pragma solidity ^0.8.0;

import "../gmx-synthetics/contracts/callback/IOrderCallbackReceiver.sol";
import "../gmx-synthetics/contracts/callback/IGasFeeCallbackReceiver.sol";
import "../gmx-synthetics/contracts/event/EventUtils.sol";

/**
 * MaliciousCallbackReceiver
 *
 * Attempts to reenter handler methods during callback execution.
 * Used to test whether global reentrancy guard properly blocks reentry.
 */
contract MaliciousCallbackReceiver is IOrderCallbackReceiver, IGasFeeCallbackReceiver {
    address public orderHandler;
    bytes32 public targetKey; // Key to attempt cancellation on

    bool public afterOrderExecutionAttempted;
    bool public afterOrderExecutionReentered;

    bool public afterOrderCancellationAttempted;
    bool public afterOrderCancellationReentered;

    bool public refundExecutionFeeAttempted;
    bool public refundExecutionFeeReentered;

    constructor(address _orderHandler) {
        orderHandler = _orderHandler;
    }

    function setTargetKey(bytes32 _targetKey) external {
        targetKey = _targetKey;
    }

    function afterOrderExecution(
        bytes32 key,
        EventUtils.EventLogData memory /* order */,
        EventUtils.EventLogData memory /* eventData */
    ) external {
        afterOrderExecutionAttempted = true;
        // Attempt to reenter: call cancelOrder on the same order key during execution callback
        (bool success, ) = orderHandler.call(
            abi.encodeWithSignature("cancelOrder(bytes32)", targetKey)
        );
        if (success) {
            afterOrderExecutionReentered = true;
        }
    }

    function afterOrderCancellation(
        bytes32 key,
        EventUtils.EventLogData memory /* order */,
        EventUtils.EventLogData memory /* eventData */
    ) external {
        afterOrderCancellationAttempted = true;
        // Attempt to reenter: call createOrder during cancellation callback
        // This is harder to test directly without full params, so we just try cancelOrder on another key
        (bool success, ) = orderHandler.call(
            abi.encodeWithSignature("cancelOrder(bytes32)", targetKey)
        );
        if (success) {
            afterOrderCancellationReentered = true;
        }
    }

    function afterOrderFrozen(
        bytes32 /* key */,
        EventUtils.EventLogData memory /* order */,
        EventUtils.EventLogData memory /* eventData */
    ) external {
        // No reentry attempt on frozen
    }

    function refundExecutionFee(
        bytes32 /* key */,
        EventUtils.EventLogData memory /* eventData */
    ) external payable {
        refundExecutionFeeAttempted = true;
        // Attempt to reenter during refund callback
        (bool success, ) = orderHandler.call(
            abi.encodeWithSignature("cancelOrder(bytes32)", targetKey)
        );
        if (success) {
            refundExecutionFeeReentered = true;
        }
    }

    // Allow contract to receive ETH (for refunds)
    receive() external payable {}
}
