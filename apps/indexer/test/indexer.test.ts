import { count, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IngestionRepository, schema, TokenRepository, type DatabaseHandle } from '@eoi/database';
import { createTestDatabase } from '@eoi/database/testing';
import { SEPOLIA } from '@eoi/shared';
import { Indexer, ReorgTooDeepError, type IndexerOptions, type Logger } from '../src/indexer';
import { IndexerMetrics } from '../src/metrics';
import { addr, FakeChain } from './fake-chain';

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
const alice = addr('alice');
const bob = addr('bob');
const token = addr('token');

const baseOptions: IndexerOptions = {
  chainId: SEPOLIA.id,
  confirmations: 2,
  startBlock: { kind: 'absolute', block: 0n },
  batchSize: 5,
  fetchConcurrency: 3,
  pollIntervalMs: 1,
  maxReorgDepth: 10,
  metadataBatchSize: 10,
};

let handle: DatabaseHandle;

beforeEach(async () => {
  handle = await createTestDatabase();
  await new IngestionRepository(handle.db, SEPOLIA.id).ensureChain(SEPOLIA);
});

afterEach(async () => {
  await handle.close();
});

function makeIndexer(chain: FakeChain, options: Partial<IndexerOptions> = {}) {
  return new Indexer(
    { ...baseOptions, ...options },
    {
      provider: chain,
      ingestion: new IngestionRepository(handle.db, SEPOLIA.id),
      tokens: new TokenRepository(handle.db, SEPOLIA.id),
      metrics: new IndexerMetrics(() => chain.stats()),
      logger: silent,
      sleep: () => Promise.resolve(),
    },
  );
}

async function blockCount(): Promise<number> {
  const [row] = await handle.db.select({ n: count() }).from(schema.blocks);
  return row?.n ?? 0;
}

async function drain(indexer: Indexer): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if ((await indexer.runOnce()).kind === 'at-head') return;
  }
  throw new Error('indexer did not reach head');
}

describe('Indexer', () => {
  it('indexes sequentially in batches up to the confirmation-depth safe head', async () => {
    const chain = new FakeChain(13);
    const indexer = makeIndexer(chain);

    expect(await indexer.runOnce()).toEqual({ kind: 'processed', from: 0n, to: 4n });
    await drain(indexer);

    // head = 12, confirmations = 2 -> blocks 0..10 indexed, 11 and 12 not yet.
    expect(await blockCount()).toBe(11);
    expect(
      (await new IngestionRepository(handle.db, SEPOLIA.id).getCheckpoint())?.blockNumber,
    ).toBe(10n);
  });

  it('persists ERC-20 transfers, tokens and log-emitting contracts', async () => {
    const chain = new FakeChain(5, (n) =>
      n === 1n ? [{ from: alice, to: token, erc20: [{ token, to: bob, value: 42n }] }] : [],
    );
    await drain(makeIndexer(chain, { confirmations: 0 }));

    const transfers = await handle.db.select().from(schema.tokenTransfers);
    expect(transfers).toEqual([
      expect.objectContaining({
        tokenAddress: token,
        fromAddress: alice,
        toAddress: bob,
        value: 42n,
      }),
    ]);
    const [contract] = await handle.db
      .select()
      .from(schema.addresses)
      .where(eq(schema.addresses.address, token));
    expect(contract).toMatchObject({ kind: 'contract', kindSource: 'emitted-log' });
  });

  it('resumes from the checkpoint after a restart without re-fetching processed blocks', async () => {
    const chain = new FakeChain(20);
    await makeIndexer(chain).runOnce();
    await makeIndexer(chain).runOnce();
    const fetchedBeforeRestart = chain.calls.getBlockWithTransactions;

    const restarted = makeIndexer(chain);
    expect(await restarted.runOnce()).toEqual({ kind: 'processed', from: 10n, to: 14n });
    expect(chain.calls.getBlockWithTransactions - fetchedBeforeRestart).toBe(5);
  });

  it('honours relative start blocks when there is no checkpoint', async () => {
    const chain = new FakeChain(100);
    const indexer = makeIndexer(chain, { startBlock: { kind: 'offset', blocks: 3n } });
    // safe head = 97 -> start at 94
    expect(await indexer.runOnce()).toEqual({ kind: 'processed', from: 94n, to: 97n });
  });

  it('detects a reorg below the safe head, rolls back to the common ancestor and re-indexes the new fork', async () => {
    const chain = new FakeChain(12);
    const indexer = makeIndexer(chain, { confirmations: 0 });
    await drain(indexer);
    const repo = new IngestionRepository(handle.db, SEPOLIA.id);
    const orphanHash = await repo.getStoredBlockHash(9n);

    chain.reorg(8n, 6, 'fork-b'); // blocks 8.. replaced; new head = 13

    const outcome = await indexer.runOnce();
    expect(outcome).toEqual({ kind: 'reorg', commonAncestor: 7n, removedBlocks: 4 });
    await drain(indexer);

    expect(await repo.getStoredBlockHash(9n)).not.toBe(orphanHash);
    expect(await repo.getStoredBlockHash(13n)).toBe((await chain.getBlockHeader(13n)).hash);
    expect(await blockCount()).toBe(14);
  });

  it('refuses to auto-repair a reorg deeper than the configured maximum', async () => {
    const chain = new FakeChain(30);
    const indexer = makeIndexer(chain, { confirmations: 0, maxReorgDepth: 3, batchSize: 50 });
    await drain(indexer);
    chain.reorg(10n, 25, 'deep');
    await expect(indexer.runOnce()).rejects.toBeInstanceOf(ReorgTooDeepError);
  });

  it('keeps running after transient RPC failures (retry with backoff) and stops on abort', async () => {
    const chain = new FakeChain(8);
    chain.failNext(2);
    const controller = new AbortController();
    let iterations = 0;
    const runner = new Indexer(
      { ...baseOptions, confirmations: 0 },
      {
        provider: chain,
        ingestion: new IngestionRepository(handle.db, SEPOLIA.id),
        tokens: new TokenRepository(handle.db, SEPOLIA.id),
        metrics: new IndexerMetrics(() => chain.stats()),
        logger: silent,
        sleep: () => {
          if (++iterations > 5) controller.abort();
          return Promise.resolve();
        },
      },
    );
    await runner.run(controller.signal);
    expect(await blockCount()).toBe(8);
  });

  it('is idempotent when the same range is indexed twice (e.g. crash before checkpoint read)', async () => {
    const chain = new FakeChain(6, () => [{ from: alice, to: bob }]);
    await drain(makeIndexer(chain, { confirmations: 0 }));
    await handle.db.delete(schema.syncState);
    await drain(makeIndexer(chain, { confirmations: 0 }));
    const [row] = await handle.db.select({ n: count() }).from(schema.transactions);
    expect(row?.n).toBe(6);
  });
});
