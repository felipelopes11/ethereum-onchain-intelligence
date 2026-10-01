import type {
  blocks,
  erc1155Transfers,
  erc721Transfers,
  logs,
  tokenTransfers,
  transactionReceipts,
  transactions,
} from './schema';
import type { TokenStandard } from '@eoi/shared';

type Hex = `0x${string}`;

export type NewBlock = typeof blocks.$inferInsert;
export type NewTransaction = typeof transactions.$inferInsert;
export type NewReceipt = typeof transactionReceipts.$inferInsert;
export type NewLog = typeof logs.$inferInsert;
export type NewErc20Transfer = typeof tokenTransfers.$inferInsert;
export type NewErc721Transfer = typeof erc721Transfers.$inferInsert;
export type NewErc1155Transfer = typeof erc1155Transfers.$inferInsert;

export interface ObservedContract {
  address: Hex;
  /** Set only when the deployment itself was observed (receipt.contractAddress). */
  deployment: { deployer: Hex; transactionHash: Hex; blockNumber: bigint } | null;
  /** How we know this is a contract: from a deployment receipt or because it emitted a log. */
  evidence: 'deployment-receipt' | 'emitted-log';
  interfaces: TokenStandard[];
}

export interface ObservedToken {
  address: Hex;
  standard: TokenStandard;
}

/**
 * Everything derived from a single block, ready to persist atomically.
 * Produced by the indexer; the database package does not know about RPC types.
 */
export interface BlockBundle {
  block: NewBlock;
  transactions: NewTransaction[];
  receipts: NewReceipt[];
  logs: NewLog[];
  erc20Transfers: NewErc20Transfer[];
  erc721Transfers: NewErc721Transfer[];
  erc1155Transfers: NewErc1155Transfer[];
  contracts: ObservedContract[];
  tokens: ObservedToken[];
}

export interface Checkpoint {
  blockNumber: bigint;
  blockHash: Hex;
}
