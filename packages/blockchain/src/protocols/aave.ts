import {
  aavePoolAddressesProviderAbi,
  aaveV3FaucetAbi,
  aaveV3PoolAbi,
  aaveV3WrappedTokenGatewayAbi,
} from '../abis/aave';
import type { ProtocolAdapter } from './types';

const SEPOLIA_POOL = '0x6ae43d3271ff6888e7fc43fd7321a503ff738951';
const SEPOLIA_ADDRESSES_PROVIDER = '0x012bac54348c0e635dcac9d5fb99f06f24136c9a';

/**
 * Aave V3 Sepolia market (from the official aave-address-book). Verified on-chain:
 * the PoolAddressesProvider returns this Pool from `getPool()` and vice versa.
 */
export const aaveV3Adapter: ProtocolAdapter = {
  id: 'aave-v3',
  name: 'Aave V3',
  category: 'lending',
  website: 'https://aave.com',
  deployments: {
    11155111: [
      {
        address: SEPOLIA_POOL,
        role: 'pool',
        abiIds: ['aave-v3-pool'],
        verification: {
          functionSignature: 'function ADDRESSES_PROVIDER() view returns (address)',
          expect: { kind: 'address', equals: SEPOLIA_ADDRESSES_PROVIDER },
        },
      },
      {
        address: SEPOLIA_ADDRESSES_PROVIDER,
        role: 'pool-addresses-provider',
        abiIds: ['aave-v3-addresses-provider'],
        verification: {
          functionSignature: 'function getPool() view returns (address)',
          expect: { kind: 'address', equals: SEPOLIA_POOL },
        },
      },
      {
        address: '0x387d311e47e80b498169e6fb51d3193167d89f7d',
        role: 'wrapped-token-gateway',
        abiIds: ['aave-v3-weth-gateway'],
      },
      {
        address: '0xc959483dba39aa9e78757139af0e9a2edeb3f42d',
        role: 'testnet-faucet',
        abiIds: ['aave-v3-faucet'],
      },
    ],
  },
  abis: [
    { id: 'aave-v3-pool', abi: aaveV3PoolAbi },
    { id: 'aave-v3-addresses-provider', abi: aavePoolAddressesProviderAbi },
    { id: 'aave-v3-weth-gateway', abi: aaveV3WrappedTokenGatewayAbi },
    { id: 'aave-v3-faucet', abi: aaveV3FaucetAbi },
  ],
  functionActions: {
    supply: 'supply',
    depositETH: 'supply',
    withdraw: 'withdraw',
    withdrawETH: 'withdraw',
    borrow: 'borrow',
    borrowETH: 'borrow',
    repay: 'repay',
    repayETH: 'repay',
    repayWithATokens: 'repay',
    liquidationCall: 'liquidation',
    flashLoanSimple: 'flash-loan',
    setUserUseReserveAsCollateral: 'collateral-config',
    mint: 'faucet-mint',
  },
  eventActions: {
    Supply: 'supply',
    Withdraw: 'withdraw',
    Borrow: 'borrow',
    Repay: 'repay',
    LiquidationCall: 'liquidation',
  },
};
