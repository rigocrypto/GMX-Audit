// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20Minimal {
    function approve(address spender, uint256 amount) external returns (bool);
}

contract MaliciousReentryCallback {
    address public target;
    bytes public payload;
    uint256 public valueToSend;

    bool public reentrancyAttempted;
    bool public reentrancySucceeded;
    bytes public lastReturnData;
    uint256 public callbackCount;

    function configureReentry(address _target, bytes calldata _payload, uint256 _valueToSend) external {
        target = _target;
        payload = _payload;
        valueToSend = _valueToSend;
    }

    function approveToken(address token, address spender, uint256 amount) external {
        IERC20Minimal(token).approve(spender, amount);
    }

    function _attemptReentry() internal {
        callbackCount += 1;
        reentrancyAttempted = true;

        (bool success, bytes memory returnData) = target.call{ value: valueToSend }(payload);
        reentrancySucceeded = success;
        lastReturnData = returnData;
    }

    fallback() external payable {
        _attemptReentry();
    }

    receive() external payable {}
}
