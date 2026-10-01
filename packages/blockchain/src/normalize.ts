import type { Block, Log, Transaction, TransactionReceipt } from 'viem';
import type { Hex } from '@eoi/shared';
import { DataInconsistencyError } from './provider';
import type { ChainBlock, ChainLog, ChainReceipt, ChainTransaction } from './types';

const lower = (value: string): Hex => value.toLowerCase() as Hex;
/** For fields viem types as required that some nodes omit in practice. */
const optional = <T>(value: T | undefined): T | null => value ?? null;
const lowerOrNull = (value: string | null | undefined): Hex | null => (value ? lower(value) : null);

function required<T>(value: T | null | undefined, field: string): T {
  if (value === null || value === undefined) {
    // Pending blocks/transactions have null numbers and hashes; we never index those.
    throw new DataInconsistencyError(
      `RPC returned a pending or incomplete object: missing ${field}`,
    );
  }
  return value;
}

export function normalizeTransaction(tx: Transaction): ChainTransaction {
  return {
    hash: lower(tx.hash),
    blockNumber: required(tx.blockNumber, 'transaction.blockNumber'),
    blockHash: lower(required(tx.blockHash, 'transaction.blockHash')),
    transactionIndex: required(tx.transactionIndex, 'transaction.transactionIndex'),
    from: lower(tx.from),
    to: lowerOrNull(tx.to),
    value: tx.value,
    nonce: BigInt(tx.nonce),
    type: Number.parseInt(tx.typeHex ?? '0x0', 16),
    gas: tx.gas,
    gasPrice: tx.gasPrice ?? null,
    maxFeePerGas: tx.maxFeePerGas ?? null,
    maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? null,
    input: lower(tx.input),
  };
}

export function normalizeBlock(block: Block<bigint, true>): ChainBlock {
  return {
    number: required(block.number, 'block.number'),
    hash: lower(required(block.hash, 'block.hash')),
    parentHash: lower(block.parentHash),
    timestamp: block.timestamp,
    miner: lower(block.miner),
    gasUsed: block.gasUsed,
    gasLimit: block.gasLimit,
    baseFeePerGas: block.baseFeePerGas ?? null,
    transactions: block.transactions.map(normalizeTransaction),
  };
}

export function normalizeLog(log: Log): ChainLog {
  return {
    address: lower(log.address),
    topics: log.topics.map(lower),
    data: lower(log.data),
    logIndex: required(log.logIndex, 'log.logIndex'),
    blockNumber: required(log.blockNumber, 'log.blockNumber'),
    blockHash: lower(required(log.blockHash, 'log.blockHash')),
    transactionHash: lower(required(log.transactionHash, 'log.transactionHash')),
    transactionIndex: required(log.transactionIndex, 'log.transactionIndex'),
    removed: log.removed,
  };
}

export function normalizeReceipt(receipt: TransactionReceipt): ChainReceipt {
  return {
    transactionHash: lower(receipt.transactionHash),
    blockNumber: receipt.blockNumber,
    blockHash: lower(receipt.blockHash),
    transactionIndex: receipt.transactionIndex,
    from: lower(receipt.from),
    to: lowerOrNull(receipt.to),
    status: receipt.status,
    gasUsed: receipt.gasUsed,
    cumulativeGasUsed: receipt.cumulativeGasUsed,
    // Some pre-London nodes omit it; never fabricate a value.
    effectiveGasPrice: optional(receipt.effectiveGasPrice),
    contractAddress: lowerOrNull(receipt.contractAddress),
    logs: receipt.logs.map(normalizeLog),
  };
}

/**
 * Receipts must belong to the exact block we fetched. A mismatch means the node
 * served data from a different fork (or a lagging backend) between the two calls.
 */
export function assertReceiptsMatchBlock(
  block: { number: bigint; hash: Hex; transactions: readonly { hash: Hex }[] },
  receipts: readonly ChainReceipt[],
): void {
  if (receipts.length !== block.transactions.length) {
    throw new DataInconsistencyError(
      `Block ${block.number}: ${block.transactions.length} transactions but ${receipts.length} receipts`,
    );
  }
  const expected = new Set(block.transactions.map((tx) => tx.hash));
  for (const receipt of receipts) {
    if (receipt.blockHash !== block.hash) {
      throw new DataInconsistencyError(
        `Block ${block.number}: receipt ${receipt.transactionHash} belongs to block ${receipt.blockHash}`,
      );
    }
    if (!expected.has(receipt.transactionHash)) {
      throw new DataInconsistencyError(
        `Block ${block.number}: unexpected receipt ${receipt.transactionHash}`,
      );
    }
  }
}
