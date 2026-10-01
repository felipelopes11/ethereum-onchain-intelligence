import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  ADDRESS_KINDS,
  ADDRESS_KIND_SOURCES,
  PROTOCOL_CATEGORIES,
  TOKEN_METADATA_STATUSES,
  TOKEN_STANDARDS,
} from '@eoi/shared';
import { address, blockNumber, hash, hexData, uint256 } from './columns';

/*
 * Reorg model: every row derived from a block hangs off `blocks` through a chain of
 * ON DELETE CASCADE foreign keys (blocks -> transactions -> receipts/logs -> transfers).
 * Rolling back a fork is therefore a single `DELETE FROM blocks WHERE number >= fork`.
 * Rows that are not owned by a single block (addresses, contracts, tokens) carry
 * `first_observed_block` so a rollback can remove the ones first seen on the dead fork.
 */

export const addressKind = pgEnum('address_kind', ADDRESS_KINDS);
export const addressKindSource = pgEnum('address_kind_source', ADDRESS_KIND_SOURCES);
export const tokenStandard = pgEnum('token_standard', TOKEN_STANDARDS);
export const tokenMetadataStatus = pgEnum('token_metadata_status', TOKEN_METADATA_STATUSES);
export const protocolCategory = pgEnum('protocol_category', PROTOCOL_CATEGORIES);

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const chains = pgTable('chains', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  isTestnet: boolean('is_testnet').notNull(),
  createdAt: createdAt(),
});

export const blocks = pgTable(
  'blocks',
  {
    chainId: integer('chain_id')
      .notNull()
      .references(() => chains.id),
    number: blockNumber('number').notNull(),
    hash: hash('hash').notNull(),
    parentHash: hash('parent_hash').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    miner: address('miner').notNull(),
    gasUsed: uint256('gas_used').notNull(),
    gasLimit: uint256('gas_limit').notNull(),
    baseFeePerGas: uint256('base_fee_per_gas'),
    transactionCount: integer('transaction_count').notNull(),
    indexedAt: timestamp('indexed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.number] }),
    uniqueIndex('blocks_chain_hash_uq').on(t.chainId, t.hash),
    index('blocks_chain_timestamp_idx').on(t.chainId, t.timestamp),
    check('blocks_hash_format', sql`${t.hash} ~ '^0x[0-9a-f]{64}$'`),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    chainId: integer('chain_id').notNull(),
    hash: hash('hash').notNull(),
    blockNumber: blockNumber('block_number').notNull(),
    transactionIndex: integer('transaction_index').notNull(),
    fromAddress: address('from_address').notNull(),
    toAddress: address('to_address'),
    value: uint256('value').notNull(),
    nonce: blockNumber('nonce').notNull(),
    type: smallint('type').notNull(),
    gasLimit: uint256('gas_limit').notNull(),
    gasPrice: uint256('gas_price'),
    maxFeePerGas: uint256('max_fee_per_gas'),
    maxPriorityFeePerGas: uint256('max_priority_fee_per_gas'),
    input: hexData('input').notNull(),
    /** First 4 bytes of calldata, denormalised so selector statistics do not scan `input`. */
    selector: varchar('selector', { length: 10 }).$type<`0x${string}`>(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.hash] }),
    foreignKey({
      columns: [t.chainId, t.blockNumber],
      foreignColumns: [blocks.chainId, blocks.number],
    }).onDelete('cascade'),
    uniqueIndex('transactions_chain_block_position_uq').on(
      t.chainId,
      t.blockNumber,
      t.transactionIndex,
    ),
    // Address history pages are keyset-paginated on (block_number, transaction_index).
    index('transactions_chain_from_idx').on(
      t.chainId,
      t.fromAddress,
      t.blockNumber,
      t.transactionIndex,
    ),
    index('transactions_chain_to_idx').on(
      t.chainId,
      t.toAddress,
      t.blockNumber,
      t.transactionIndex,
    ),
  ],
);

export const transactionReceipts = pgTable(
  'transaction_receipts',
  {
    chainId: integer('chain_id').notNull(),
    transactionHash: hash('transaction_hash').notNull(),
    status: smallint('status').notNull(),
    gasUsed: uint256('gas_used').notNull(),
    cumulativeGasUsed: uint256('cumulative_gas_used').notNull(),
    effectiveGasPrice: uint256('effective_gas_price'),
    contractAddress: address('contract_address'),
    logCount: integer('log_count').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.transactionHash] }),
    foreignKey({
      columns: [t.chainId, t.transactionHash],
      foreignColumns: [transactions.chainId, transactions.hash],
    }).onDelete('cascade'),
    index('receipts_chain_contract_idx')
      .on(t.chainId, t.contractAddress)
      .where(sql`${t.contractAddress} IS NOT NULL`),
    check('receipts_status_values', sql`${t.status} IN (0, 1)`),
  ],
);

export const logs = pgTable(
  'logs',
  {
    chainId: integer('chain_id').notNull(),
    blockNumber: blockNumber('block_number').notNull(),
    logIndex: integer('log_index').notNull(),
    transactionHash: hash('transaction_hash').notNull(),
    address: address('address').notNull(),
    topic0: hash('topic0'),
    topic1: hash('topic1'),
    topic2: hash('topic2'),
    topic3: hash('topic3'),
    data: hexData('data').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.blockNumber, t.logIndex] }),
    foreignKey({
      columns: [t.chainId, t.transactionHash],
      foreignColumns: [transactions.chainId, transactions.hash],
    }).onDelete('cascade'),
    index('logs_chain_tx_idx').on(t.chainId, t.transactionHash),
    index('logs_chain_address_idx').on(t.chainId, t.address, t.blockNumber),
    index('logs_chain_topic0_idx').on(t.chainId, t.topic0),
  ],
);

export const addresses = pgTable(
  'addresses',
  {
    chainId: integer('chain_id')
      .notNull()
      .references(() => chains.id),
    address: address('address').notNull(),
    kind: addressKind('kind').notNull().default('unknown'),
    kindSource: addressKindSource('kind_source'),
    /** Block at which `eth_getCode` was evaluated, when that was the source. */
    kindCheckedAtBlock: blockNumber('kind_checked_at_block'),
    /** Null for addresses discovered outside the indexing pipeline (e.g. API lookups). */
    firstObservedBlock: blockNumber('first_observed_block'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.address] }),
    index('addresses_first_observed_idx').on(t.chainId, t.firstObservedBlock),
    check('addresses_format', sql`${t.address} ~ '^0x[0-9a-f]{40}$'`),
  ],
);

export const contracts = pgTable(
  'contracts',
  {
    chainId: integer('chain_id').notNull(),
    address: address('address').notNull(),
    deployer: address('deployer'),
    deploymentTransactionHash: hash('deployment_transaction_hash'),
    deploymentBlock: blockNumber('deployment_block'),
    /** Token standards whose events this contract has been observed emitting. */
    interfaces: tokenStandard('interfaces')
      .array()
      .notNull()
      .default(sql`'{}'`),
    firstObservedBlock: blockNumber('first_observed_block').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.address] }),
    foreignKey({
      columns: [t.chainId, t.address],
      foreignColumns: [addresses.chainId, addresses.address],
    }).onDelete('cascade'),
    index('contracts_chain_deployer_idx')
      .on(t.chainId, t.deployer)
      .where(sql`${t.deployer} IS NOT NULL`),
    index('contracts_first_observed_idx').on(t.chainId, t.firstObservedBlock),
  ],
);

export const tokens = pgTable(
  'tokens',
  {
    chainId: integer('chain_id').notNull(),
    address: address('address').notNull(),
    standard: tokenStandard('standard'),
    name: varchar('name', { length: 128 }),
    symbol: varchar('symbol', { length: 32 }),
    decimals: smallint('decimals'),
    totalSupply: uint256('total_supply'),
    metadataStatus: tokenMetadataStatus('metadata_status').notNull().default('pending'),
    metadataError: varchar('metadata_error', { length: 256 }),
    metadataFetchedAt: timestamp('metadata_fetched_at', { withTimezone: true }),
    firstObservedBlock: blockNumber('first_observed_block').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.address] }),
    foreignKey({
      columns: [t.chainId, t.address],
      foreignColumns: [contracts.chainId, contracts.address],
    }).onDelete('cascade'),
    index('tokens_metadata_pending_idx')
      .on(t.chainId, t.firstObservedBlock)
      .where(sql`${t.metadataStatus} = 'pending'`),
    check('tokens_decimals_range', sql`${t.decimals} IS NULL OR ${t.decimals} BETWEEN 0 AND 255`),
  ],
);

const transferColumns = {
  chainId: integer('chain_id').notNull(),
  blockNumber: blockNumber('block_number').notNull(),
  logIndex: integer('log_index').notNull(),
  transactionHash: hash('transaction_hash').notNull(),
  tokenAddress: address('token_address').notNull(),
  fromAddress: address('from_address').notNull(),
  toAddress: address('to_address').notNull(),
};

export const tokenTransfers = pgTable(
  'token_transfers',
  { ...transferColumns, value: uint256('value').notNull() },
  (t) => [
    primaryKey({ columns: [t.chainId, t.blockNumber, t.logIndex] }),
    foreignKey({
      columns: [t.chainId, t.blockNumber, t.logIndex],
      foreignColumns: [logs.chainId, logs.blockNumber, logs.logIndex],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.chainId, t.tokenAddress],
      foreignColumns: [tokens.chainId, tokens.address],
    }).onDelete('cascade'),
    index('token_transfers_from_idx').on(t.chainId, t.fromAddress, t.blockNumber),
    index('token_transfers_to_idx').on(t.chainId, t.toAddress, t.blockNumber),
    index('token_transfers_token_idx').on(t.chainId, t.tokenAddress, t.blockNumber),
  ],
);

export const erc721Transfers = pgTable(
  'erc721_transfers',
  { ...transferColumns, tokenId: uint256('token_id').notNull() },
  (t) => [
    primaryKey({ columns: [t.chainId, t.blockNumber, t.logIndex] }),
    foreignKey({
      columns: [t.chainId, t.blockNumber, t.logIndex],
      foreignColumns: [logs.chainId, logs.blockNumber, logs.logIndex],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.chainId, t.tokenAddress],
      foreignColumns: [tokens.chainId, tokens.address],
    }).onDelete('cascade'),
    index('erc721_transfers_from_idx').on(t.chainId, t.fromAddress, t.blockNumber),
    index('erc721_transfers_to_idx').on(t.chainId, t.toAddress, t.blockNumber),
    index('erc721_transfers_token_idx').on(t.chainId, t.tokenAddress, t.tokenId),
  ],
);

export const erc1155Transfers = pgTable(
  'erc1155_transfers',
  {
    ...transferColumns,
    /** Position within a TransferBatch; always 0 for TransferSingle. */
    batchIndex: integer('batch_index').notNull(),
    operator: address('operator').notNull(),
    tokenId: uint256('token_id').notNull(),
    value: uint256('value').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.blockNumber, t.logIndex, t.batchIndex] }),
    foreignKey({
      columns: [t.chainId, t.blockNumber, t.logIndex],
      foreignColumns: [logs.chainId, logs.blockNumber, logs.logIndex],
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.chainId, t.tokenAddress],
      foreignColumns: [tokens.chainId, tokens.address],
    }).onDelete('cascade'),
    index('erc1155_transfers_from_idx').on(t.chainId, t.fromAddress, t.blockNumber),
    index('erc1155_transfers_to_idx').on(t.chainId, t.toAddress, t.blockNumber),
    index('erc1155_transfers_token_idx').on(t.chainId, t.tokenAddress, t.tokenId),
  ],
);

export const protocols = pgTable('protocols', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: text('name').notNull(),
  category: protocolCategory('category').notNull(),
  website: text('website'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const protocolContracts = pgTable(
  'protocol_contracts',
  {
    chainId: integer('chain_id')
      .notNull()
      .references(() => chains.id),
    address: address('address').notNull(),
    protocolId: varchar('protocol_id', { length: 64 })
      .notNull()
      .references(() => protocols.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 64 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.address] }),
    index('protocol_contracts_protocol_idx').on(t.protocolId),
  ],
);

export const walletLabels = pgTable(
  'wallet_labels',
  {
    id: serial('id').primaryKey(),
    chainId: integer('chain_id')
      .notNull()
      .references(() => chains.id),
    address: address('address').notNull(),
    label: varchar('label', { length: 128 }).notNull(),
    category: varchar('category', { length: 64 }).notNull(),
    /** Where the label comes from, e.g. `protocol-registry:uniswap-v3`. Never anonymous. */
    source: varchar('source', { length: 128 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('wallet_labels_unique').on(t.chainId, t.address, t.label, t.source),
    index('wallet_labels_address_idx').on(t.chainId, t.address),
  ],
);

export const syncState = pgTable(
  'sync_state',
  {
    chainId: integer('chain_id')
      .notNull()
      .references(() => chains.id),
    indexerId: varchar('indexer_id', { length: 64 }).notNull(),
    lastProcessedBlock: blockNumber('last_processed_block').notNull(),
    lastProcessedHash: hash('last_processed_hash').notNull(),
    /** First block this indexer processed; lower bound of data coverage. */
    startBlock: blockNumber('start_block').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.chainId, t.indexerId] })],
);
