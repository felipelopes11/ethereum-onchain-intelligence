import { createHash } from 'node:crypto';
import type { BlockBundle, NewLog } from './types';

type Hex = `0x${string}`;

const TRANSFER_TOPIC: Hex = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

/** Deterministic, obviously synthetic values for tests. Never real chain data. */
export function fakeHash(seed: string): Hex {
  return `0x${createHash('sha256').update(`hash:${seed}`).digest('hex')}`;
}

export function fakeAddress(seed: string): Hex {
  return `0x${createHash('sha256').update(`addr:${seed}`).digest('hex').slice(0, 40)}`;
}

const padTopic = (address: Hex): Hex => `0x${address.slice(2).padStart(64, '0')}`;
const uintData = (value: bigint): Hex => `0x${value.toString(16).padStart(64, '0')}`;

export interface FixtureErc20Transfer {
  token: Hex;
  from: Hex;
  to: Hex;
  value: bigint;
}

export interface FixtureTransaction {
  hash?: Hex;
  from: Hex;
  to: Hex | null;
  value?: bigint;
  input?: Hex;
  status?: 0 | 1;
  deploys?: Hex;
  erc20Transfers?: FixtureErc20Transfer[];
}

export interface FixtureBlock {
  chainId: number;
  number: bigint;
  hash?: Hex;
  parentHash?: Hex;
  timestamp?: Date;
  transactions?: FixtureTransaction[];
  /** Fork label: produces different hashes for the same height. */
  fork?: string;
}

export function blockHashFor(number: bigint, fork = 'canonical'): Hex {
  return fakeHash(`block:${fork}:${number}`);
}

export function buildBlockBundle(spec: FixtureBlock): BlockBundle {
  const fork = spec.fork ?? 'canonical';
  const hash = spec.hash ?? blockHashFor(spec.number, fork);
  const parentHash = spec.parentHash ?? blockHashFor(spec.number - 1n, fork);
  const timestamp = spec.timestamp ?? new Date(Date.UTC(2026, 0, 1) + Number(spec.number) * 12_000);
  const bundle: BlockBundle = {
    block: {
      chainId: spec.chainId,
      number: spec.number,
      hash,
      parentHash,
      timestamp,
      miner: fakeAddress('miner'),
      gasUsed: 21_000n,
      gasLimit: 30_000_000n,
      baseFeePerGas: 1_000_000_000n,
      transactionCount: spec.transactions?.length ?? 0,
    },
    transactions: [],
    receipts: [],
    logs: [],
    erc20Transfers: [],
    erc721Transfers: [],
    erc1155Transfers: [],
    contracts: [],
    tokens: [],
  };

  let logIndex = 0;
  (spec.transactions ?? []).forEach((tx, transactionIndex) => {
    const txHash = tx.hash ?? fakeHash(`tx:${fork}:${spec.number}:${transactionIndex}`);
    const input = tx.input ?? '0x';
    bundle.transactions.push({
      chainId: spec.chainId,
      hash: txHash,
      blockNumber: spec.number,
      transactionIndex,
      fromAddress: tx.from,
      toAddress: tx.to,
      value: tx.value ?? 0n,
      nonce: BigInt(transactionIndex),
      type: 2,
      gasLimit: 100_000n,
      gasPrice: null,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      input,
      selector: input.length >= 10 ? (input.slice(0, 10) as Hex) : null,
    });
    const txLogs: NewLog[] = [];
    for (const transfer of tx.erc20Transfers ?? []) {
      const log: NewLog = {
        chainId: spec.chainId,
        blockNumber: spec.number,
        logIndex: logIndex++,
        transactionHash: txHash,
        address: transfer.token,
        topic0: TRANSFER_TOPIC,
        topic1: padTopic(transfer.from),
        topic2: padTopic(transfer.to),
        topic3: null,
        data: uintData(transfer.value),
      };
      txLogs.push(log);
      bundle.erc20Transfers.push({
        chainId: spec.chainId,
        blockNumber: spec.number,
        logIndex: log.logIndex,
        transactionHash: txHash,
        tokenAddress: transfer.token,
        fromAddress: transfer.from,
        toAddress: transfer.to,
        value: transfer.value,
      });
      if (!bundle.contracts.some((c) => c.address === transfer.token)) {
        bundle.contracts.push({
          address: transfer.token,
          deployment: null,
          evidence: 'emitted-log',
          interfaces: ['erc20'],
        });
        bundle.tokens.push({ address: transfer.token, standard: 'erc20' });
      }
    }
    bundle.logs.push(...txLogs);
    if (tx.deploys) {
      bundle.contracts.push({
        address: tx.deploys,
        deployment: { deployer: tx.from, transactionHash: txHash, blockNumber: spec.number },
        evidence: 'deployment-receipt',
        interfaces: [],
      });
    }
    bundle.receipts.push({
      chainId: spec.chainId,
      transactionHash: txHash,
      status: tx.status ?? 1,
      gasUsed: 50_000n,
      cumulativeGasUsed: 50_000n * BigInt(transactionIndex + 1),
      effectiveGasPrice: 1_500_000_000n,
      contractAddress: tx.deploys ?? null,
      logCount: txLogs.length,
    });
  });
  return bundle;
}

/** Builds a linked chain of bundles from `from` to `to` inclusive. */
export function buildChain(
  chainId: number,
  from: bigint,
  to: bigint,
  transactionsFor: (n: bigint) => FixtureTransaction[] = () => [],
  fork?: string,
): BlockBundle[] {
  const out: BlockBundle[] = [];
  for (let n = from; n <= to; n++) {
    out.push(
      buildBlockBundle({
        chainId,
        number: n,
        transactions: transactionsFor(n),
        ...(fork ? { fork } : {}),
      }),
    );
  }
  return out;
}
