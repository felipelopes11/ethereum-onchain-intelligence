// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title OnChainIntelligenceRegistry
/// @notice Public, tamper-evident record of the platform's releases and of the indexer
///         configuration it supports per chain. Anyone can verify which code version
///         (git commit) and database schema produced a deployment's data.
/// @dev Intentionally small. It stores only metadata that does not already exist on
///      chain: no indexed data, no balances, no user information. Not upgradeable:
///      a new version is a new deployment, referenced from the off-chain config.
contract OnChainIntelligenceRegistry is Ownable2Step {
    /// @notice Version of this contract's interface.
    string public constant CONTRACT_VERSION = "1.0.0";

    /// @notice Upper bound for semantic version strings (e.g. "1.2.3-rc.1").
    uint256 public constant MAX_VERSION_LENGTH = 32;

    /// @notice Sanity bound for confirmation depth; deeper values indicate a config mistake.
    uint64 public constant MAX_CONFIRMATIONS = 1024;

    struct Release {
        string version;
        bytes20 commit;
        uint32 schemaVersion;
        uint64 publishedAt;
    }

    struct ChainConfig {
        uint64 confirmations;
        uint64 startBlock;
        bool enabled;
    }

    Release[] private _releases;
    mapping(uint256 chainId => ChainConfig) private _chains;

    event ReleasePublished(
        uint256 indexed index, string version, bytes20 indexed commit, uint32 schemaVersion
    );
    event ChainConfigured(uint256 indexed chainId, uint64 confirmations, uint64 startBlock);
    event ChainDisabled(uint256 indexed chainId);

    error EmptyVersion();
    error VersionTooLong(uint256 length);
    error ZeroCommit();
    error InvalidChainId();
    error ConfirmationsTooHigh(uint64 confirmations);
    error ChainNotConfigured(uint256 chainId);
    error NoReleases();
    error ReleaseOutOfRange(uint256 index);
    error RenounceDisabled();

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Records a new platform release.
    /// @param version Semantic version string, 1..MAX_VERSION_LENGTH bytes.
    /// @param commit Git commit hash (SHA-1) the release was built from.
    /// @param schemaVersion Database schema (migration) version shipped with it.
    function publishRelease(string calldata version, bytes20 commit, uint32 schemaVersion)
        external
        onlyOwner
        returns (uint256 index)
    {
        uint256 length = bytes(version).length;
        if (length == 0) revert EmptyVersion();
        if (length > MAX_VERSION_LENGTH) revert VersionTooLong(length);
        if (commit == bytes20(0)) revert ZeroCommit();

        index = _releases.length;
        _releases.push(
            Release({
                version: version,
                commit: commit,
                schemaVersion: schemaVersion,
                publishedAt: SafeCast.toUint64(block.timestamp)
            })
        );
        emit ReleasePublished(index, version, commit, schemaVersion);
    }

    /// @notice Declares (or updates) indexer settings for a chain.
    function configureChain(uint256 chainId, uint64 confirmations, uint64 startBlock)
        external
        onlyOwner
    {
        if (chainId == 0) revert InvalidChainId();
        if (confirmations > MAX_CONFIRMATIONS) revert ConfirmationsTooHigh(confirmations);
        _chains[chainId] =
            ChainConfig({confirmations: confirmations, startBlock: startBlock, enabled: true});
        emit ChainConfigured(chainId, confirmations, startBlock);
    }

    function disableChain(uint256 chainId) external onlyOwner {
        if (!_chains[chainId].enabled) revert ChainNotConfigured(chainId);
        _chains[chainId].enabled = false;
        emit ChainDisabled(chainId);
    }

    function releaseCount() external view returns (uint256) {
        return _releases.length;
    }

    function release(uint256 index) external view returns (Release memory) {
        if (index >= _releases.length) revert ReleaseOutOfRange(index);
        return _releases[index];
    }

    function latestRelease() external view returns (Release memory) {
        uint256 count = _releases.length;
        if (count == 0) revert NoReleases();
        return _releases[count - 1];
    }

    function chainConfig(uint256 chainId) external view returns (ChainConfig memory) {
        return _chains[chainId];
    }

    function isChainSupported(uint256 chainId) external view returns (bool) {
        return _chains[chainId].enabled;
    }

    /// @dev Renouncing would freeze the registry forever with no recovery path, so it is
    ///      disabled. Ownership can still be handed over through the two-step transfer.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }
}
