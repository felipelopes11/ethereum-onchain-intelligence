import type { Hex } from '@eoi/shared';

/*
 * Normalised chain data. Every address and hash is lowercase so values can be compared
 * and stored without re-normalising. These types are independent of viem so the rest
 * of the system does not depend on a specific client library's shapes.
 */

export interface ChainTransaction {
  hash: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  transactionIndex: number;
  from: Hex;
  to: Hex | null;
  value: bigint;
  nonce: bigint;
  /** EIP-2718 type: 0 legacy, 1 access list, 2 EIP-1559, 3 blob, 4 set-code. */
  type: number;
  gas: bigint;
  gasPrice: bigint | null;
  maxFeePerGas: bigint | null;
  maxPriorityFeePerGas: bigint | null;
  input: Hex;
}

export interface ChainBlock {
  number: bigint;
  hash: Hex;
  parentHash: Hex;
  timestamp: bigint;
  miner: Hex;
  gasUsed: bigint;
  gasLimit: bigint;
  baseFeePerGas: bigint | null;
  transactions: ChainTransaction[];
}

export interface ChainBlockHeader {
  number: bigint;
  hash: Hex;
  parentHash: Hex;
  timestamp: bigint;
}

export interface ChainLog {
  address: Hex;
  topics: Hex[];
  data: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  transactionIndex: number;
  removed: boolean;
}

export interface ChainReceipt {
  transactionHash: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  transactionIndex: number;
  from: Hex;
  to: Hex | null;
  status: 'success' | 'reverted';
  gasUsed: bigint;
  cumulativeGasUsed: bigint;
  effectiveGasPrice: bigint | null;
  contractAddress: Hex | null;
  logs: ChainLog[];
}

export interface ContractReadCall {
  address: Hex;
  /** ABI-encoded calldata. */
  data: Hex;
}

export type ContractReadResult = { success: true; data: Hex } | { success: false; error: string };
