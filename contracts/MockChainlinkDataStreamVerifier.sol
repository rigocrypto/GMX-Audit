// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockChainlinkDataStreamVerifier {
    function verify(bytes calldata payload, bytes calldata) external payable returns (bytes memory verifierResponse) {
        return payload;
    }
}