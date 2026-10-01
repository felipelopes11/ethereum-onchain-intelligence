import type { Hex } from '@eoi/shared';
import type {
  ChainBlock,
  ChainBlockHeader,
  ChainReceipt,
  ChainTransaction,
  ContractReadCall,
  ContractReadResult,
} from './types';

export interface ProviderStats {
  requests: number;
  errors: number;
  retries: number;
  /** eth_call executions that reverted: expected answers, not failures. */
  reverts: number;
}

/**
 * The only way the application talks to an Ethereum node. Implementations own
 * transport concerns (batching, retries, rate limiting); callers see plain data.
 */
export interface BlockchainProvider {
  readonly chainId: number;
  getChainId(): Promise<number>;
  getLatestBlockNumber(): Promise<bigint>;
  /** Block tagged `finalized` by the consensus layer, or null if the node does not expose it. */
  getFinalizedBlockNumber(): Promise<bigint | null>;
  getBlockHeader(blockNumber: bigint): Promise<ChainBlockHeader>;
  getBlockWithTransactions(blockNumber: bigint): Promise<ChainBlock>;
  getBlockReceipts(
    block: Pick<ChainBlock, 'number' | 'hash' | 'transactions'>,
  ): Promise<ChainReceipt[]>;
  getTransaction(hash: Hex): Promise<ChainTransaction | null>;
  getTransactionReceipt(hash: Hex): Promise<ChainReceipt | null>;
  getBlockTimestamp(blockNumber: bigint): Promise<bigint>;
  getBalance(address: Hex): Promise<{ wei: bigint; blockNumber: bigint }>;
  getTransactionCount(address: Hex): Promise<number>;
  getCode(address: Hex): Promise<Hex | null>;
  /** Executes read-only calls. Individual failures are returned, never thrown. */
  readContracts(calls: readonly ContractReadCall[]): Promise<ContractReadResult[]>;
  stats(): ProviderStats;
}

/** Optional mainnet-only capability, kept separate so the core works without it. */
export interface EnsResolver {
  resolveName(name: string): Promise<Hex | null>;
  lookupAddress(address: Hex): Promise<string | null>;
}

export class DataInconsistencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataInconsistencyError';
  }
}
