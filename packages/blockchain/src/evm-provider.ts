import {
  createPublicClient,
  formatTransactionReceipt,
  http,
  type Chain,
  type PublicClient,
  type RpcTransactionReceipt,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
} from 'viem';
import type { Hex } from '@eoi/shared';
import {
  describeError,
  isExecutionRevertError,
  isMethodUnsupportedError,
  isRetryableRpcError,
} from './errors';
import {
  assertReceiptsMatchBlock,
  normalizeBlock,
  normalizeReceipt,
  normalizeTransaction,
} from './normalize';
import type { BlockchainProvider, ProviderStats } from './provider';
import { DataInconsistencyError } from './provider';
import { TokenBucketRateLimiter } from './rate-limiter';
import { withRetry } from './retry';
import type {
  ChainBlock,
  ChainBlockHeader,
  ChainReceipt,
  ChainTransaction,
  ContractReadCall,
  ContractReadResult,
} from './types';

/** viem types mined fields as non-null, but nodes return null for pending transactions. */
function isPending(tx: { blockNumber: bigint | null }): boolean {
  return tx.blockNumber === null;
}

export interface EvmProviderOptions {
  rpcUrl: string;
  chainId: number;
  chain?: Chain;
  timeoutMs?: number;
  maxRetries?: number;
  maxRequestsPerSecond?: number;
  onRetry?: (info: { method: string; attempt: number; delayMs: number; error: string }) => void;
  /** Injectable for tests. */
  client?: PublicClient;
}

export class EvmProvider implements BlockchainProvider {
  readonly chainId: number;
  private readonly client: PublicClient;
  private readonly limiter: TokenBucketRateLimiter;
  private readonly maxRetries: number;
  private readonly counters: ProviderStats = { requests: 0, errors: 0, retries: 0, reverts: 0 };
  /** Learned at runtime: not every node supports eth_getBlockReceipts. */
  private blockReceiptsSupported = true;

  constructor(private readonly options: EvmProviderOptions) {
    this.chainId = options.chainId;
    this.maxRetries = options.maxRetries ?? 5;
    this.limiter = new TokenBucketRateLimiter(options.maxRequestsPerSecond ?? 10);
    this.client =
      options.client ??
      createPublicClient({
        ...(options.chain ? { chain: options.chain } : {}),
        // Retries are handled here (with rate-limit awareness), not inside the transport.
        transport: http(options.rpcUrl, {
          batch: { batchSize: 50, wait: 10 },
          retryCount: 0,
          timeout: options.timeoutMs ?? 15_000,
        }),
      });
  }

  stats(): ProviderStats {
    return { ...this.counters };
  }

  private async call<T>(method: string, fn: () => Promise<T>): Promise<T> {
    return withRetry(
      async () => {
        await this.limiter.acquire();
        this.counters.requests++;
        try {
          return await fn();
        } catch (error) {
          // A revert is a valid answer from the node (e.g. optional `name()` missing),
          // not an infrastructure failure; keep it out of the error rate.
          if (isExecutionRevertError(error)) this.counters.reverts++;
          else this.counters.errors++;
          throw error;
        }
      },
      {
        retries: this.maxRetries,
        isRetryable: isRetryableRpcError,
        onRetry: ({ attempt, delayMs, error }) => {
          this.counters.retries++;
          this.options.onRetry?.({ method, attempt, delayMs, error: describeError(error) });
        },
      },
    );
  }

  async getChainId(): Promise<number> {
    return this.call('eth_chainId', () => this.client.getChainId());
  }

  async getLatestBlockNumber(): Promise<bigint> {
    return this.call('eth_blockNumber', () => this.client.getBlockNumber({ cacheTime: 0 }));
  }

  async getFinalizedBlockNumber(): Promise<bigint | null> {
    try {
      const block = await this.call('eth_getBlockByNumber(finalized)', () =>
        this.client.getBlock({ blockTag: 'finalized' }),
      );
      return block.number;
    } catch (error) {
      if (isMethodUnsupportedError(error)) return null;
      throw error;
    }
  }

  async getBlockHeader(blockNumber: bigint): Promise<ChainBlockHeader> {
    const block = await this.call('eth_getBlockByNumber', () =>
      this.client.getBlock({ blockNumber, includeTransactions: false }),
    );
    return {
      number: block.number,
      hash: block.hash.toLowerCase() as Hex,
      parentHash: block.parentHash.toLowerCase() as Hex,
      timestamp: block.timestamp,
    };
  }

  async getBlockWithTransactions(blockNumber: bigint): Promise<ChainBlock> {
    const block = await this.call('eth_getBlockByNumber', () =>
      this.client.getBlock({ blockNumber, includeTransactions: true }),
    );
    return normalizeBlock(block);
  }

  async getBlockTimestamp(blockNumber: bigint): Promise<bigint> {
    return (await this.getBlockHeader(blockNumber)).timestamp;
  }

  async getBlockReceipts(
    block: Pick<ChainBlock, 'number' | 'hash' | 'transactions'>,
  ): Promise<ChainReceipt[]> {
    if (block.transactions.length === 0) return [];
    let receipts: ChainReceipt[] | null = null;
    if (this.blockReceiptsSupported) {
      try {
        receipts = await this.fetchBlockReceipts(block.hash);
      } catch (error) {
        if (!isMethodUnsupportedError(error)) throw error;
        this.blockReceiptsSupported = false;
      }
    }
    receipts ??= await Promise.all(
      block.transactions.map(async (tx) => {
        const receipt = await this.getTransactionReceipt(tx.hash);
        if (!receipt) throw new DataInconsistencyError(`Missing receipt for ${tx.hash}`);
        return receipt;
      }),
    );
    assertReceiptsMatchBlock(block, receipts);
    return receipts;
  }

  /** Querying by hash (not number) guarantees the receipts come from the block we hold. */
  private async fetchBlockReceipts(blockHash: Hex): Promise<ChainReceipt[]> {
    const raw = await this.call('eth_getBlockReceipts', () =>
      this.client.request<{
        Method: 'eth_getBlockReceipts';
        Parameters: [Hex];
        ReturnType: RpcTransactionReceipt[] | null;
      }>({ method: 'eth_getBlockReceipts', params: [blockHash] }),
    );
    if (!raw) throw new DataInconsistencyError(`Node returned no receipts for block ${blockHash}`);
    return raw.map((receipt) => normalizeReceipt(formatTransactionReceipt(receipt)));
  }

  async getTransaction(hash: Hex): Promise<ChainTransaction | null> {
    try {
      const tx = await this.call('eth_getTransactionByHash', () =>
        this.client.getTransaction({ hash }),
      );
      // Pending transactions have no block yet; the platform only reports mined data.
      if (isPending(tx)) return null;
      return normalizeTransaction(tx);
    } catch (error) {
      if (error instanceof TransactionNotFoundError) return null;
      throw error;
    }
  }

  async getTransactionReceipt(hash: Hex): Promise<ChainReceipt | null> {
    try {
      const receipt = await this.call('eth_getTransactionReceipt', () =>
        this.client.getTransactionReceipt({ hash }),
      );
      return normalizeReceipt(receipt);
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return null;
      throw error;
    }
  }

  async getBalance(address: Hex): Promise<{ wei: bigint; blockNumber: bigint }> {
    // Pin both reads to the same block so the reported balance has a precise height.
    const blockNumber = await this.getLatestBlockNumber();
    const wei = await this.call('eth_getBalance', () =>
      this.client.getBalance({ address, blockNumber }),
    );
    return { wei, blockNumber };
  }

  async getTransactionCount(address: Hex): Promise<number> {
    return this.call('eth_getTransactionCount', () => this.client.getTransactionCount({ address }));
  }

  async getCode(address: Hex): Promise<Hex | null> {
    const code = await this.call('eth_getCode', () => this.client.getCode({ address }));
    return code && code !== '0x' ? (code.toLowerCase() as Hex) : null;
  }

  async readContracts(calls: readonly ContractReadCall[]): Promise<ContractReadResult[]> {
    return Promise.all(
      calls.map(async ({ address, data }): Promise<ContractReadResult> => {
        try {
          const result = await this.call('eth_call', () => this.client.call({ to: address, data }));
          return result.data
            ? { success: true, data: result.data }
            : { success: false, error: 'empty return data' };
        } catch (error) {
          return { success: false, error: describeError(error) };
        }
      }),
    );
  }
}
