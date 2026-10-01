// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {OnChainIntelligenceRegistry} from "../src/OnChainIntelligenceRegistry.sol";

/// @notice Deploys the registry owned by the broadcasting account.
/// @dev Sign with an encrypted keystore, never a raw key in an env file:
///   cast wallet import deployer --interactive
///   forge script script/Deploy.s.sol --rpc-url $ETHEREUM_RPC_URL --account deployer --broadcast
contract Deploy is Script {
    function run() external returns (OnChainIntelligenceRegistry registry) {
        vm.startBroadcast();
        registry = new OnChainIntelligenceRegistry(msg.sender);
        vm.stopBroadcast();
        console.log("OnChainIntelligenceRegistry deployed at", address(registry));
    }
}
