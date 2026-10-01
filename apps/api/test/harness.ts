import type { FastifyInstance } from 'fastify';
import { encodeFunctionData, type Hex } from 'viem';
import {
  AbiRegistry,
  ProtocolRegistry,
  uniswapV3SwapRouter02Abi,
  type BlockchainProvider,
  type ChainReceipt,
  type ChainTransaction,
} from '@eoi/blockchain';
import {
  IngestionRepository,
  ProtocolRepository,
  TokenRepository,
  type DatabaseHandle,
} from '@eoi/database';
import { buildChain, createTestDatabase, fakeAddress } from '@eoi/database/testing';
import { SEPOLIA } from '@eoi/shared';
import { buildApp, type AppOptions } from '../src/app';
import { createCaches, type ApiContext } from '../src/context';

export const CHAIN = SEPOLIA.id;
export const alice = fakeAddress('alice');
export const bob = fakeAddress('bob');
export const usdc = fakeAddress('usdc');
/** Real Uniswap SwapRouter02 Sepolia address, so protocol detection is exercised for real. */
export const SWAP_ROUTER: Hex = '0x3bfa4769fb09eefc5a80d6e87c3b9c650f7ae48e';

export const SWAP_INPUT = encodeFunctionData({
  abi: uniswapV3SwapRouter02Abi,
  functionName: 'exactInputSingle',
  args: [
    {
      tokenIn: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
      tokenOut: usdc,
      fee: 3000,
      recipient: alice,
      amountIn: 10n ** 16n,
      amountOutMinimum: 0n,
      sqrtPriceLimitX96: 0n,
    },
  ],
}).toLowerCase() as Hex;

export type ProviderOverrides = Partial<BlockchainProvider>;

export function stubProvider(overrides: ProviderOverrides = {}): BlockchainProvider {
  const base: BlockchainProvider = {
    chainId: CHAIN,
    getChainId: () => Promise.resolve(CHAIN),
    getLatestBlockNumber: () => Promise.resolve(50n),
    getFinalizedBlockNumber: () => Promise.resolve(null),
    getBlockHeader: () => Promise.reject(new Error('not stubbed')),
    getBlockWithTransactions: () => Promise.reject(new Error('not stubbed')),
    getBlockReceipts: () => Promise.reject(new Error('not stubbed')),
    getTransaction: () => Promise.resolve(null),
    getTransactionReceipt: () => Promise.resolve(null),
    getBlockTimestamp: () => Promise.resolve(1_800_000_000n),
    getBalance: () => Promise.resolve({ wei: 1_500_000_000_000_000_000n, blockNumber: 50n }),
    getTransactionCount: () => Promise.resolve(42),
    getCode: (address) => Promise.resolve(address === SWAP_ROUTER ? '0x6080' : null),
    readContracts: () => Promise.resolve([]),
    stats: () => ({ requests: 0, errors: 0, retries: 0, reverts: 0 }),
  };
  return { ...base, ...overrides };
}

export interface Harness {
  app: FastifyInstance;
  handle: DatabaseHandle;
  close(): Promise<void>;
}

/**
 * Seeds blocks 1..30: alice pays bob every block; on even blocks she swaps on the real
 * Uniswap SwapRouter02 address and receives 25 USDC (6 decimals) from it.
 */
export async function createHarness(
  provider: BlockchainProvider = stubProvider(),
  options: Partial<AppOptions> = {},
): Promise<Harness> {
  const handle = await createTestDatabase();
  const ingestion = new IngestionRepository(handle.db, CHAIN);
  await ingestion.ensureChain(SEPOLIA);
  const protocols = new ProtocolRegistry(CHAIN);
  await new ProtocolRepository(handle.db, CHAIN).sync(
    protocols.adapters.map((a) => ({
      id: a.id,
      name: a.name,
      category: a.category,
      website: a.website,
      contracts: (a.deployments[CHAIN] ?? []).map(({ address, role }) => ({ address, role })),
    })),
  );
  await ingestion.persistBlocks(
    buildChain(CHAIN, 1n, 30n, (n) => [
      { from: alice, to: bob, value: 10n ** 15n },
      ...(n % 2n === 0n
        ? [
            {
              from: alice,
              to: SWAP_ROUTER,
              input: SWAP_INPUT,
              erc20Transfers: [{ token: usdc, from: SWAP_ROUTER, to: alice, value: 25_000_000n }],
            },
          ]
        : []),
    ]),
  );
  await new TokenRepository(handle.db, CHAIN).updateMetadata(usdc, {
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 6,
    totalSupply: 10n ** 12n,
    status: 'complete',
    error: null,
    declaredInterfaces: [],
  });

  const ctx: ApiContext = {
    chain: SEPOLIA,
    db: handle.db,
    pingDatabase: () => handle.ping(),
    provider,
    ens: null,
    protocols,
    abis: new AbiRegistry(protocols.abiSources()),
    caches: createCaches(1_000),
    logger: { warn: () => undefined, error: () => undefined },
    now: () => new Date('2026-10-01T00:00:00Z'),
  };
  const app = await buildApp(ctx, {
    corsOrigins: ['http://localhost:3000'],
    rateLimit: { max: 1_000, windowMs: 60_000 },
    trustProxy: false,
    ...options,
  });
  return {
    app,
    handle,
    close: async () => {
      await app.close();
      await handle.close();
    },
  };
}

export function rpcTransaction(hash: Hex): { tx: ChainTransaction; receipt: ChainReceipt } {
  const blockHash: Hex = `0x${'cd'.repeat(32)}`;
  return {
    tx: {
      hash,
      blockNumber: 999n,
      blockHash,
      transactionIndex: 0,
      from: alice,
      to: bob,
      value: 1n,
      nonce: 7n,
      type: 2,
      gas: 21_000n,
      gasPrice: null,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
      input: '0x',
    },
    receipt: {
      transactionHash: hash,
      blockNumber: 999n,
      blockHash,
      transactionIndex: 0,
      from: alice,
      to: bob,
      status: 'success',
      gasUsed: 21_000n,
      cumulativeGasUsed: 21_000n,
      effectiveGasPrice: 2n,
      contractAddress: null,
      logs: [],
    },
  };
}
