// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RevertingCallbackReceiver {
    fallback() external payable {
        revert("callback-revert");
    }

    receive() external payable {
        revert("callback-revert");
    }
}
