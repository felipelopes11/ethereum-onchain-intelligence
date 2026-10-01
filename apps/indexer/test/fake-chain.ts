import { createHash } from 'node:crypto';
import { encodeAbiParameters, encodeEventTopics, type Hex } from 'viem';
import {
  DataInconsistencyError,
  erc20Abi,
  type BlockchainProvider,
  type ChainBlock,
  type ChainBlockHeader,
  type ChainLog,
  type ChainReceipt,
  type ChainTransaction,
  type ContractReadCall,
  type ContractReadResult,
  type ProviderStats,
} from '@eoi/blockchain';

const h = (seed: string): Hex => `0x${createHash('sha256').update(seed).digest('hex')}`;
export const addr = (seed: string): Hex =>
  `0x${createHash('sha256').update(`a:${seed}`).digest('hex').slice(0, 40)}`;

export interface FakeTx {
  from: Hex;
  to: Hex | null;
  erc20?: { token: Hex; to: Hex; value: bigint }[];
  deploys?: Hex;
}

interface StoredBlock {
  block: ChainBlock;
  receipts: ChainReceipt[];
}

/**
 * In-memory chain implementing BlockchainProvider. Supports forks (`reorg`) and
 * injected failures so indexer behaviour can be tested deterministically.
 */
export class FakeChain implements BlockchainProvider {
  readonly chainId = 11155111;
  private blocks: StoredBlock[] = [];
  private failuresRemaining = 0;
  calls = { getBlockWithTransactions: 0 };
  tokenMetadata = new Map<
    Hex,
    Partial<Record<'name' | 'symbol' | 'decimals' | 'totalSupply', Hex>>
  >();

  constructor(length: number, txsFor: (n: bigint) => FakeTx[] = () => []) {
    for (let n = 0n; n < BigInt(length); n++) this.append('main', txsFor(n));
  }

  get head(): bigint {
    return BigInt(this.blocks.length - 1);
  }

  append(fork: string, txs: FakeTx[] = []): void {
    const number = BigInt(this.blocks.length);
    const parentHash = this.blocks.at(-1)?.block.hash ?? `0x${'00'.repeat(32)}`;
    const hash = h(`block:${fork}:${number}:${parentHash}`);
    let logIndex = 0;
    const transactions: ChainTransaction[] = txs.map((tx, transactionIndex) => ({
      hash: h(`tx:${hash}:${transactionIndex}`),
      blockNumber: number,
      blockHash: hash,
      transactionIndex,
      from: tx.from,
      to: tx.to,
      value: 0n,
      nonce: BigInt(transactionIndex),
      type: 2,
      gas: 100_000n,
      gasPrice: null,
      maxFeePerGas: 2n,
      maxPriorityFeePerGas: 1n,
      input: '0x',
    }));
    const receipts: ChainReceipt[] = txs.map((tx, i) => {
      const txHash = transactions[i]!.hash;
      const logs: ChainLog[] = (tx.erc20 ?? []).map((transfer) => ({
        address: transfer.token,
        topics: encodeEventTopics({
          abi: erc20Abi,
          eventName: 'Transfer',
          args: { from: tx.from, to: transfer.to },
        }).map((t) => (t as Hex).toLowerCase() as Hex),
        data: encodeAbiParameters([{ type: 'uint256' }], [transfer.value]),
        logIndex: logIndex++,
        blockNumber: number,
        blockHash: hash,
        transactionHash: txHash,
        transactionIndex: i,
        removed: false,
      }));
      return {
        transactionHash: txHash,
        blockNumber: number,
        blockHash: hash,
        transactionIndex: i,
        from: tx.from,
        to: tx.to,
        status: 'success',
        gasUsed: 21_000n,
        cumulativeGasUsed: 21_000n * BigInt(i + 1),
        effectiveGasPrice: 2n,
        contractAddress: tx.deploys ?? null,
        logs,
      };
    });
    this.blocks.push({
      block: {
        number,
        hash,
        parentHash,
        timestamp: 1_700_000_000n + number * 12n,
        miner: addr('miner'),
        gasUsed: 0n,
        gasLimit: 30_000_000n,
        baseFeePerGas: 1n,
        transactions,
      },
      receipts,
    });
  }

  /** Replaces every block from `fromBlock` with a new fork of `newLength` blocks. */
  reorg(fromBlock: bigint, newLength: number, fork: string): void {
    this.blocks = this.blocks.slice(0, Number(fromBlock));
    for (let i = 0; i < newLength; i++) this.append(fork);
  }

  failNext(times: number): void {
    this.failuresRemaining = times;
  }

  private maybeFail(): void {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining--;
      throw new DataInconsistencyError('injected failure');
    }
  }

  private get(n: bigint): StoredBlock {
    const stored = this.blocks[Number(n)];
    if (!stored) throw new Error(`block ${n} not found`);
    return stored;
  }

  getChainId = () => Promise.resolve(this.chainId);
  getLatestBlockNumber = () => {
    this.maybeFail();
    return Promise.resolve(this.head);
  };
  getFinalizedBlockNumber = () => Promise.resolve(null);
  getBlockHeader = (n: bigint): Promise<ChainBlockHeader> => {
    const { block } = this.get(n);
    return Promise.resolve({
      number: block.number,
      hash: block.hash,
      parentHash: block.parentHash,
      timestamp: block.timestamp,
    });
  };
  getBlockWithTransactions = (n: bigint) => {
    this.calls.getBlockWithTransactions++;
    return Promise.resolve(structuredClone(this.get(n).block));
  };
  getBlockReceipts = (block: Pick<ChainBlock, 'number'>) =>
    Promise.resolve(structuredClone(this.get(block.number).receipts));
  getTransaction = () => Promise.resolve(null);
  getTransactionReceipt = () => Promise.resolve(null);
  getBlockTimestamp = (n: bigint) => Promise.resolve(this.get(n).block.timestamp);
  getBalance = () => Promise.resolve({ wei: 0n, blockNumber: this.head });
  getTransactionCount = () => Promise.resolve(0);
  getCode = () => Promise.resolve(null);
  readContracts = (calls: readonly ContractReadCall[]): Promise<ContractReadResult[]> =>
    Promise.resolve(calls.map(() => ({ success: false, error: 'not implemented in fake' })));
  stats = (): ProviderStats => ({ requests: 0, errors: 0, retries: 0, reverts: 0 });
}
