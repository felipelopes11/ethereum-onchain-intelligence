import { and, eq, gt, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { ChainInfo, TokenStandard } from '@eoi/shared';
import { chunkForInsert } from '../batch';
import type { Database } from '../client';
import {
  addresses,
  blocks,
  chains,
  contracts,
  erc1155Transfers,
  erc721Transfers,
  logs,
  syncState,
  tokenTransfers,
  tokens,
  transactionReceipts,
  transactions,
} from '../schema';
import type { BlockBundle, Checkpoint, ObservedContract, ObservedToken } from '../types';

type Hex = `0x${string}`;

const excluded = (column: string) => sql.raw(`excluded.${column}`);

async function insertIgnoringDuplicates<TTable extends PgTable>(
  db: Database,
  table: TTable,
  rows: readonly TTable['$inferInsert'][],
): Promise<void> {
  for (const chunk of chunkForInsert(rows)) {
    await db.insert(table).values(chunk).onConflictDoNothing();
  }
}

interface MergedContract extends ObservedContract {
  firstObservedBlock: bigint;
}

function mergeContracts(bundles: readonly BlockBundle[]): MergedContract[] {
  const byAddress = new Map<Hex, MergedContract>();
  for (const bundle of bundles) {
    for (const contract of bundle.contracts) {
      const existing = byAddress.get(contract.address);
      if (!existing) {
        byAddress.set(contract.address, {
          ...contract,
          interfaces: [...contract.interfaces],
          firstObservedBlock: bundle.block.number,
        });
        continue;
      }
      existing.deployment ??= contract.deployment;
      if (contract.evidence === 'deployment-receipt') existing.evidence = 'deployment-receipt';
      existing.interfaces = [...new Set([...existing.interfaces, ...contract.interfaces])];
    }
  }
  return [...byAddress.values()];
}

function mergeTokens(
  bundles: readonly BlockBundle[],
): (ObservedToken & { firstObservedBlock: bigint })[] {
  const byAddress = new Map<Hex, ObservedToken & { firstObservedBlock: bigint }>();
  for (const bundle of bundles) {
    for (const token of bundle.tokens) {
      if (!byAddress.has(token.address)) {
        byAddress.set(token.address, { ...token, firstObservedBlock: bundle.block.number });
      }
    }
  }
  return [...byAddress.values()];
}

/**
 * Write side of the indexer. Each call is one database transaction: either a whole
 * batch of blocks (and the checkpoint that covers it) is committed, or nothing is.
 * All inserts are idempotent, so replaying a batch after a crash is safe.
 */
export class IngestionRepository {
  constructor(
    private readonly db: Database,
    private readonly chainId: number,
    private readonly indexerId = 'main',
  ) {}

  async ensureChain(chain: ChainInfo): Promise<void> {
    await this.db
      .insert(chains)
      .values({ id: chain.id, name: chain.name, isTestnet: chain.isTestnet })
      .onConflictDoUpdate({ target: chains.id, set: { name: chain.name } });
  }

  async getCheckpoint(): Promise<(Checkpoint & { startBlock: bigint }) | null> {
    const [row] = await this.db
      .select()
      .from(syncState)
      .where(and(eq(syncState.chainId, this.chainId), eq(syncState.indexerId, this.indexerId)));
    return row
      ? {
          blockNumber: row.lastProcessedBlock,
          blockHash: row.lastProcessedHash,
          startBlock: row.startBlock,
        }
      : null;
  }

  async getStoredBlockHash(blockNumber: bigint): Promise<Hex | null> {
    const [row] = await this.db
      .select({ hash: blocks.hash })
      .from(blocks)
      .where(and(eq(blocks.chainId, this.chainId), eq(blocks.number, blockNumber)));
    return row?.hash ?? null;
  }

  async persistBlocks(bundles: readonly BlockBundle[]): Promise<void> {
    const first = bundles[0];
    const last = bundles.at(-1);
    if (!first || !last) return;

    await this.db.transaction(async (tx) => {
      await insertIgnoringDuplicates(
        tx,
        blocks,
        bundles.map((b) => b.block),
      );
      const mergedContracts = mergeContracts(bundles);
      await this.upsertContracts(tx, mergedContracts);
      await this.upsertTokens(tx, mergeTokens(bundles));
      await insertIgnoringDuplicates(
        tx,
        transactions,
        bundles.flatMap((b) => b.transactions),
      );
      await insertIgnoringDuplicates(
        tx,
        transactionReceipts,
        bundles.flatMap((b) => b.receipts),
      );
      await insertIgnoringDuplicates(
        tx,
        logs,
        bundles.flatMap((b) => b.logs),
      );
      await insertIgnoringDuplicates(
        tx,
        tokenTransfers,
        bundles.flatMap((b) => b.erc20Transfers),
      );
      await insertIgnoringDuplicates(
        tx,
        erc721Transfers,
        bundles.flatMap((b) => b.erc721Transfers),
      );
      await insertIgnoringDuplicates(
        tx,
        erc1155Transfers,
        bundles.flatMap((b) => b.erc1155Transfers),
      );
      await this.writeCheckpoint(
        tx,
        { blockNumber: last.block.number, blockHash: last.block.hash },
        first.block.number,
      );
    });
  }

  /**
   * Removes every block above `keepUpTo` and everything derived from it, then moves
   * the checkpoint back. Used when a reorg is detected.
   */
  async rollbackTo(keepUpTo: bigint): Promise<{ removedBlocks: number }> {
    return this.db.transaction(async (tx) => {
      const removed = await tx
        .delete(blocks)
        .where(and(eq(blocks.chainId, this.chainId), gt(blocks.number, keepUpTo)))
        .returning({ number: blocks.number });
      // Order matters: tokens -> contracts -> addresses follow the FK chain.
      await tx
        .delete(tokens)
        .where(and(eq(tokens.chainId, this.chainId), gt(tokens.firstObservedBlock, keepUpTo)));
      await tx
        .delete(contracts)
        .where(
          and(eq(contracts.chainId, this.chainId), gt(contracts.firstObservedBlock, keepUpTo)),
        );
      await tx
        .delete(addresses)
        .where(
          and(eq(addresses.chainId, this.chainId), gt(addresses.firstObservedBlock, keepUpTo)),
        );

      const [anchor] = await tx
        .select({ hash: blocks.hash })
        .from(blocks)
        .where(and(eq(blocks.chainId, this.chainId), eq(blocks.number, keepUpTo)));
      if (anchor) {
        await this.writeCheckpoint(tx, { blockNumber: keepUpTo, blockHash: anchor.hash }, keepUpTo);
      } else {
        // Rolled back past the first indexed block: restart from configuration.
        await tx
          .delete(syncState)
          .where(and(eq(syncState.chainId, this.chainId), eq(syncState.indexerId, this.indexerId)));
      }
      return { removedBlocks: removed.length };
    });
  }

  private async writeCheckpoint(
    db: Database,
    checkpoint: Checkpoint,
    startBlock: bigint,
  ): Promise<void> {
    await db
      .insert(syncState)
      .values({
        chainId: this.chainId,
        indexerId: this.indexerId,
        lastProcessedBlock: checkpoint.blockNumber,
        lastProcessedHash: checkpoint.blockHash,
        startBlock,
      })
      .onConflictDoUpdate({
        target: [syncState.chainId, syncState.indexerId],
        set: {
          lastProcessedBlock: checkpoint.blockNumber,
          lastProcessedHash: checkpoint.blockHash,
          // Coverage never starts later than the first block ever processed.
          startBlock: sql`least(${syncState.startBlock}, ${startBlock})`,
          updatedAt: sql`now()`,
        },
      });
  }

  private async upsertContracts(db: Database, observed: readonly MergedContract[]): Promise<void> {
    if (observed.length === 0) return;
    for (const chunk of chunkForInsert(observed)) {
      await db
        .insert(addresses)
        .values(
          chunk.map((c) => ({
            chainId: this.chainId,
            address: c.address,
            kind: 'contract' as const,
            kindSource: c.evidence,
            firstObservedBlock: c.firstObservedBlock,
          })),
        )
        .onConflictDoUpdate({
          target: [addresses.chainId, addresses.address],
          set: {
            kind: sql`'contract'`,
            // Prefer the strongest evidence: deployment receipt > emitted log > eth_getCode.
            kindSource: sql`CASE
              WHEN ${addresses.kindSource} = 'deployment-receipt' THEN ${addresses.kindSource}
              WHEN ${excluded('kind_source')} = 'deployment-receipt' THEN ${excluded('kind_source')}
              WHEN ${addresses.kindSource} = 'emitted-log' THEN ${addresses.kindSource}
              ELSE ${excluded('kind_source')} END`,
            firstObservedBlock: sql`least(${addresses.firstObservedBlock}, ${excluded('first_observed_block')})`,
            updatedAt: sql`now()`,
          },
        });

      await db
        .insert(contracts)
        .values(
          chunk.map((c) => ({
            chainId: this.chainId,
            address: c.address,
            deployer: c.deployment?.deployer ?? null,
            deploymentTransactionHash: c.deployment?.transactionHash ?? null,
            deploymentBlock: c.deployment?.blockNumber ?? null,
            interfaces: c.interfaces,
            firstObservedBlock: c.firstObservedBlock,
          })),
        )
        .onConflictDoUpdate({
          target: [contracts.chainId, contracts.address],
          set: {
            deployer: sql`coalesce(${contracts.deployer}, ${excluded('deployer')})`,
            deploymentTransactionHash: sql`coalesce(${contracts.deploymentTransactionHash}, ${excluded('deployment_transaction_hash')})`,
            deploymentBlock: sql`coalesce(${contracts.deploymentBlock}, ${excluded('deployment_block')})`,
            interfaces: sql`ARRAY(SELECT DISTINCT unnest(${contracts.interfaces} || ${excluded('interfaces')}) ORDER BY 1)`,
            firstObservedBlock: sql`least(${contracts.firstObservedBlock}, ${excluded('first_observed_block')})`,
            updatedAt: sql`now()`,
          },
        });
    }
  }

  private async upsertTokens(
    db: Database,
    observed: readonly (ObservedToken & { firstObservedBlock: bigint })[],
  ): Promise<void> {
    for (const chunk of chunkForInsert(observed)) {
      await db
        .insert(tokens)
        .values(
          chunk.map((t) => ({
            chainId: this.chainId,
            address: t.address,
            standard: t.standard satisfies TokenStandard,
            firstObservedBlock: t.firstObservedBlock,
          })),
        )
        .onConflictDoUpdate({
          target: [tokens.chainId, tokens.address],
          set: {
            standard: sql`coalesce(${tokens.standard}, ${excluded('standard')})`,
            firstObservedBlock: sql`least(${tokens.firstObservedBlock}, ${excluded('first_observed_block')})`,
          },
        });
    }
  }
}
