import {
  uniswapUniversalRouterAbi,
  uniswapV2PairAbi,
  uniswapV3PoolAbi,
  uniswapV2FactoryAbi,
  uniswapV2RouterAbi,
  uniswapV3FactoryAbi,
  uniswapV3PositionManagerAbi,
  uniswapV3SwapRouter02Abi,
} from '../abis/uniswap';
import type { ProtocolAdapter } from './types';

const SEPOLIA_V2_FACTORY = '0xf62c03e08ada871a0beb309762e260a7a6a880e6';
const SEPOLIA_V3_FACTORY = '0x0227628f3f023bb0b980b67d528571c95c6dac1c';

/**
 * Sepolia deployments from Uniswap's official deployment docs, cross-checked on-chain
 * (`npm run verify:protocols`): routers report the expected factory via `factory()`.
 */
export const uniswapAdapter: ProtocolAdapter = {
  id: 'uniswap',
  name: 'Uniswap',
  category: 'dex',
  website: 'https://uniswap.org',
  deployments: {
    11155111: [
      {
        address: '0xee567fe1712faf6149d80da1e6934e354124cfe3',
        role: 'v2-router-02',
        abiIds: ['uniswap-v2-router'],
        verification: {
          functionSignature: 'function factory() view returns (address)',
          expect: { kind: 'address', equals: SEPOLIA_V2_FACTORY },
        },
      },
      {
        address: SEPOLIA_V2_FACTORY,
        role: 'v2-factory',
        abiIds: ['uniswap-v2-factory'],
        verification: {
          functionSignature: 'function allPairsLength() view returns (uint256)',
          expect: { kind: 'nonzero' },
        },
      },
      {
        address: SEPOLIA_V3_FACTORY,
        role: 'v3-factory',
        abiIds: ['uniswap-v3-factory'],
        verification: {
          functionSignature: 'function owner() view returns (address)',
          expect: { kind: 'nonzero' },
        },
      },
      {
        address: '0x3bfa4769fb09eefc5a80d6e87c3b9c650f7ae48e',
        role: 'v3-swap-router-02',
        abiIds: ['uniswap-v3-swap-router-02'],
        verification: {
          functionSignature: 'function factory() view returns (address)',
          expect: { kind: 'address', equals: SEPOLIA_V3_FACTORY },
        },
      },
      {
        address: '0x1238536071e1c677a632429e3655c799b22cda52',
        role: 'v3-position-manager',
        abiIds: ['uniswap-v3-position-manager'],
        verification: {
          functionSignature: 'function factory() view returns (address)',
          expect: { kind: 'address', equals: SEPOLIA_V3_FACTORY },
        },
      },
      {
        address: '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad',
        role: 'universal-router',
        abiIds: ['uniswap-universal-router'],
      },
    ],
  },
  abis: [
    { id: 'uniswap-v2-router', abi: uniswapV2RouterAbi },
    { id: 'uniswap-v2-factory', abi: uniswapV2FactoryAbi },
    { id: 'uniswap-v3-factory', abi: uniswapV3FactoryAbi },
    { id: 'uniswap-v3-swap-router-02', abi: uniswapV3SwapRouter02Abi },
    { id: 'uniswap-v3-position-manager', abi: uniswapV3PositionManagerAbi },
    { id: 'uniswap-universal-router', abi: uniswapUniversalRouterAbi },
    // Pools/pairs are created permissionlessly and are not in the address registry. These
    // ABIs let the decoder read Swap/Sync/Mint/Burn layouts, but a matching layout never
    // attributes a transaction to Uniswap: anyone can emit an identical event.
    { id: 'uniswap-v2-pair-layout', abi: uniswapV2PairAbi },
    { id: 'uniswap-v3-pool-layout', abi: uniswapV3PoolAbi },
  ],
  functionActions: {
    swapExactTokensForTokens: 'swap',
    swapTokensForExactTokens: 'swap',
    swapExactETHForTokens: 'swap',
    swapTokensForExactETH: 'swap',
    swapExactTokensForETH: 'swap',
    swapETHForExactTokens: 'swap',
    swapExactTokensForTokensSupportingFeeOnTransferTokens: 'swap',
    swapExactETHForTokensSupportingFeeOnTransferTokens: 'swap',
    swapExactTokensForETHSupportingFeeOnTransferTokens: 'swap',
    exactInputSingle: 'swap',
    exactInput: 'swap',
    exactOutputSingle: 'swap',
    exactOutput: 'swap',
    addLiquidity: 'add-liquidity',
    addLiquidityETH: 'add-liquidity',
    removeLiquidity: 'remove-liquidity',
    removeLiquidityETH: 'remove-liquidity',
    mint: 'add-liquidity',
    increaseLiquidity: 'add-liquidity',
    decreaseLiquidity: 'remove-liquidity',
    collect: 'collect-fees',
    // The Universal Router and multicall wrap arbitrary inner commands; we do not
    // claim to know what they did without decoding every inner command.
    execute: 'batched-call',
    multicall: 'batched-call',
  },
  eventActions: {
    IncreaseLiquidity: 'add-liquidity',
    DecreaseLiquidity: 'remove-liquidity',
    Collect: 'collect-fees',
  },
};
