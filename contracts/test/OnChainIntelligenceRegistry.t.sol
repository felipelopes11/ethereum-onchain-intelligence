// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {OnChainIntelligenceRegistry} from "../src/OnChainIntelligenceRegistry.sol";

contract OnChainIntelligenceRegistryTest is Test {
    OnChainIntelligenceRegistry internal registry;

    address internal owner = makeAddr("owner");
    address internal stranger = makeAddr("stranger");
    bytes20 internal constant COMMIT = bytes20(hex"0123456789abcdef0123456789abcdef01234567");
    uint256 internal constant SEPOLIA = 11_155_111;

    event ReleasePublished(
        uint256 indexed index, string version, bytes20 indexed commit, uint32 schemaVersion
    );
    event ChainConfigured(uint256 indexed chainId, uint64 confirmations, uint64 startBlock);
    event ChainDisabled(uint256 indexed chainId);

    function setUp() public {
        registry = new OnChainIntelligenceRegistry(owner);
    }

    // --- releases -------------------------------------------------------------

    function test_PublishRelease_StoresMetadataAndEmits() public {
        vm.warp(1_800_000_000);
        vm.expectEmit(true, true, false, true, address(registry));
        emit ReleasePublished(0, "1.0.0", COMMIT, 2);

        vm.prank(owner);
        uint256 index = registry.publishRelease("1.0.0", COMMIT, 2);

        assertEq(index, 0);
        assertEq(registry.releaseCount(), 1);
        OnChainIntelligenceRegistry.Release memory r = registry.latestRelease();
        assertEq(r.version, "1.0.0");
        assertEq(r.commit, COMMIT);
        assertEq(r.schemaVersion, 2);
        assertEq(r.publishedAt, 1_800_000_000);
    }

    function test_LatestRelease_ReturnsMostRecent() public {
        vm.startPrank(owner);
        registry.publishRelease("1.0.0", COMMIT, 1);
        registry.publishRelease("1.1.0", bytes20(uint160(1)), 2);
        vm.stopPrank();

        assertEq(registry.latestRelease().version, "1.1.0");
        assertEq(registry.release(0).version, "1.0.0");
    }

    function test_RevertWhen_NoReleases() public {
        vm.expectRevert(OnChainIntelligenceRegistry.NoReleases.selector);
        registry.latestRelease();
    }

    function test_RevertWhen_ReleaseIndexOutOfRange() public {
        vm.expectRevert(
            abi.encodeWithSelector(OnChainIntelligenceRegistry.ReleaseOutOfRange.selector, 0)
        );
        registry.release(0);
    }

    function test_RevertWhen_PublishRelease_NotOwner() public {
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        vm.prank(stranger);
        registry.publishRelease("1.0.0", COMMIT, 1);
    }

    function test_RevertWhen_PublishRelease_EmptyVersion() public {
        vm.expectRevert(OnChainIntelligenceRegistry.EmptyVersion.selector);
        vm.prank(owner);
        registry.publishRelease("", COMMIT, 1);
    }

    function test_RevertWhen_PublishRelease_VersionTooLong() public {
        string memory tooLong = "0123456789abcdef0123456789abcdef0";
        vm.expectRevert(
            abi.encodeWithSelector(OnChainIntelligenceRegistry.VersionTooLong.selector, 33)
        );
        vm.prank(owner);
        registry.publishRelease(tooLong, COMMIT, 1);
    }

    function test_RevertWhen_PublishRelease_ZeroCommit() public {
        vm.expectRevert(OnChainIntelligenceRegistry.ZeroCommit.selector);
        vm.prank(owner);
        registry.publishRelease("1.0.0", bytes20(0), 1);
    }

    function testFuzz_PublishRelease_AcceptsAnyValidVersion(
        string calldata version,
        bytes20 commit,
        uint32 schemaVersion
    ) public {
        uint256 length = bytes(version).length;
        vm.assume(length > 0 && length <= registry.MAX_VERSION_LENGTH());
        vm.assume(commit != bytes20(0));

        vm.prank(owner);
        registry.publishRelease(version, commit, schemaVersion);

        OnChainIntelligenceRegistry.Release memory r = registry.latestRelease();
        assertEq(r.version, version);
        assertEq(r.commit, commit);
        assertEq(r.schemaVersion, schemaVersion);
    }

    // --- chains ---------------------------------------------------------------

    function test_ConfigureChain_EnablesAndEmits() public {
        vm.expectEmit(true, false, false, true, address(registry));
        emit ChainConfigured(SEPOLIA, 12, 5_000_000);

        vm.prank(owner);
        registry.configureChain(SEPOLIA, 12, 5_000_000);

        assertTrue(registry.isChainSupported(SEPOLIA));
        OnChainIntelligenceRegistry.ChainConfig memory c = registry.chainConfig(SEPOLIA);
        assertEq(c.confirmations, 12);
        assertEq(c.startBlock, 5_000_000);
    }

    function test_DisableChain() public {
        vm.startPrank(owner);
        registry.configureChain(SEPOLIA, 12, 0);
        vm.expectEmit(true, false, false, false, address(registry));
        emit ChainDisabled(SEPOLIA);
        registry.disableChain(SEPOLIA);
        vm.stopPrank();

        assertFalse(registry.isChainSupported(SEPOLIA));
        // The last known configuration is preserved for auditability.
        assertEq(registry.chainConfig(SEPOLIA).confirmations, 12);
    }

    function test_RevertWhen_DisableUnconfiguredChain() public {
        vm.expectRevert(
            abi.encodeWithSelector(OnChainIntelligenceRegistry.ChainNotConfigured.selector, 1)
        );
        vm.prank(owner);
        registry.disableChain(1);
    }

    function test_RevertWhen_ConfigureChain_ZeroChainId() public {
        vm.expectRevert(OnChainIntelligenceRegistry.InvalidChainId.selector);
        vm.prank(owner);
        registry.configureChain(0, 12, 0);
    }

    function testFuzz_ConfigureChain_BoundsConfirmations(uint256 chainId, uint64 confirmations)
        public
    {
        chainId = bound(chainId, 1, type(uint256).max);
        // Read before pranking: vm.prank applies to the very next external call.
        uint64 maxConfirmations = registry.MAX_CONFIRMATIONS();
        vm.prank(owner);
        if (confirmations > maxConfirmations) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    OnChainIntelligenceRegistry.ConfirmationsTooHigh.selector, confirmations
                )
            );
            registry.configureChain(chainId, confirmations, 0);
        } else {
            registry.configureChain(chainId, confirmations, 0);
            assertEq(registry.chainConfig(chainId).confirmations, confirmations);
        }
    }

    function test_RevertWhen_ConfigureChain_NotOwner() public {
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger)
        );
        vm.prank(stranger);
        registry.configureChain(SEPOLIA, 12, 0);
    }

    // --- ownership ------------------------------------------------------------

    function test_OwnershipTransfer_RequiresAcceptance() public {
        address next = makeAddr("next");
        vm.prank(owner);
        registry.transferOwnership(next);
        assertEq(registry.owner(), owner, "ownership must not move before acceptance");

        vm.prank(next);
        registry.acceptOwnership();
        assertEq(registry.owner(), next);
    }

    function test_RevertWhen_RenounceOwnership() public {
        vm.expectRevert(OnChainIntelligenceRegistry.RenounceDisabled.selector);
        vm.prank(owner);
        registry.renounceOwnership();
        assertEq(registry.owner(), owner);
    }

    function test_RevertWhen_ConstructedWithZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new OnChainIntelligenceRegistry(address(0));
    }
}
