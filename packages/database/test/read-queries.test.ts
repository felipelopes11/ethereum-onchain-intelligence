import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEPOLIA } from '@eoi/shared';
import type { DatabaseHandle } from '../src/client';
import { encodeCursor } from '../src/cursor';
import { AddressQueries } from '../src/repositories/address-queries';
import { IngestionRepository } from '../src/repositories/ingestion-repository';
import { ProtocolRepository } from '../src/repositories/protocol-repository';
import { InvalidCursorError, TransactionQueries } from '../src/repositories/transaction-queries';
import { buildChain, createTestDatabase, fakeAddress } from '../src/testing';

const CHAIN = SEPOLIA.id;
const alice = fakeAddress('alice');
const bob = fakeAddress('bob');
const carol = fakeAddress('carol');
const router = fakeAddress('router');
const token = fakeAddress('token');
const SWAP_INPUT = '0x414bf389' + '00'.repeat(32);

let handle: DatabaseHandle;
let addressQueries: AddressQueries;
let txQueries: TransactionQueries;

beforeAll(async () => {
  handle = await createTestDatabase();
  const ingestion = new IngestionRepository(handle.db, CHAIN);
  await ingestion.ensureChain(SEPOLIA);
  await new ProtocolRepository(handle.db, CHAIN).sync([
    {
      id: 'dex',
      name: 'Dex',
      category: 'dex',
      website: 'https://dex.test',
      contracts: [{ address: router, role: 'router' }],
    },
  ]);
  // Blocks 1..30: alice sends to bob in every block; on even blocks she also swaps on the
  // router, which emits an ERC-20 transfer from the router to alice. Carol pays alice on block 15.
  await ingestion.persistBlocks(
    buildChain(CHAIN, 1n, 30n, (n) => [
      { from: alice, to: bob, value: n },
      ...(n % 2n === 0n
        ? [
            {
              from: alice,
              to: router,
              input: SWAP_INPUT as `0x${string}`,
              erc20Transfers: [{ token, from: router, to: alice, value: 100n }],
            },
          ]
        : []),
      ...(n === 15n ? [{ from: carol, to: alice, value: 1n }] : []),
    ]),
  );
  // The router emitted no log, so nothing proves it is a contract yet; eth_getCode would.
  addressQueries = new AddressQueries(handle.db, CHAIN);
  await addressQueries.recordCodeCheck(router, true, 30n);
  txQueries = new TransactionQueries(handle.db, CHAIN);
});

afterAll(async () => {
  await handle.close();
});

describe('AddressQueries', () => {
  it('reports coverage from the checkpoint', async () => {
    expect(await addressQueries.coverage()).toMatchObject({ fromBlock: 1n, toBlock: 30n });
  });

  it('summarises activity from indexed rows', async () => {
    const summary = await addressQueries.activitySummary(alice);
    expect(summary).toMatchObject({
      sent: 45,
      received: 1,
      total: 46,
      contractsInteracted: 1,
      callsWithCalldata: 15,
      distinctTokens: 1,
      transfers: { erc20: { incoming: 15, outgoing: 0 }, erc721: { incoming: 0, outgoing: 0 } },
    });
    expect(summary.firstSeen?.blockNumber).toBe(1n);
    expect(summary.lastSeen?.blockNumber).toBe(30n);
  });

  it('counts first/last appearance through token transfers too', async () => {
    const summary = await addressQueries.activitySummary(token);
    expect(summary.total).toBe(0);
    expect(summary.firstSeen).toBeNull();
  });

  it('groups calls to known protocol contracts by selector', async () => {
    expect(await addressQueries.protocolCalls(alice)).toEqual([
      expect.objectContaining({
        protocolId: 'dex',
        role: 'router',
        selector: '0x414bf389',
        transactionCount: 15,
        successCount: 15,
        firstBlock: 2n,
        lastBlock: 30n,
      }),
    ]);
  });

  it('aggregates token flows with uint256 sums', async () => {
    expect(await addressQueries.tokenFlows(alice)).toEqual([
      expect.objectContaining({
        tokenAddress: token,
        standard: 'erc20',
        incoming: 1500n,
        outgoing: 0n,
        incomingCount: 15,
      }),
    ]);
  });

  it('ranks counterparties and joins labels', async () => {
    const parties = await addressQueries.counterparties(alice);
    expect(parties.map((p) => [p.address, p.transactionCount])).toEqual([
      [bob, 30],
      [router, 15],
      [carol, 1],
    ]);
    expect(parties[1]).toMatchObject({ kind: 'contract', protocolId: 'dex', label: 'Dex: router' });
  });

  it('buckets activity by UTC day and hour of week', async () => {
    const daily = await addressQueries.activityTimeline(alice, 'day');
    expect(daily.reduce((sum, d) => sum + d.outgoing + d.incoming, 0)).toBe(46);
    const hourly = await addressQueries.activityTimeline(alice, 'hour');
    expect(hourly[0]?.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/);
    expect(hourly.reduce((sum, d) => sum + d.outgoing + d.incoming, 0)).toBe(46);
    const matrix = await addressQueries.hourOfWeek(alice);
    expect(matrix).toHaveLength(7);
    expect(matrix.flat().reduce((a, b) => a + b, 0)).toBe(46);
  });

  it('never lets an eth_getCode result overwrite stronger evidence', async () => {
    await addressQueries.recordCodeCheck(token, false, 31n);
    expect((await addressQueries.addressRecord(token))?.kindSource).toBe('emitted-log');
  });
});

describe('TransactionQueries.listByAddress', () => {
  it('paginates newest-first without gaps or duplicates', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await txQueries.listByAddress(alice, 10, cursor);
      seen.push(...result.items.map((i) => i.hash));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(seen).toHaveLength(46);
    expect(new Set(seen).size).toBe(46);
    const first = await txQueries.listByAddress(alice, 3);
    expect(first.items.map((i) => i.blockNumber)).toEqual([30n, 30n, 29n]);
    expect(first.items[0]).toMatchObject({ status: 1, fee: 75_000_000_000_000n });
  });

  it('rejects tampered cursors', async () => {
    await expect(txQueries.listByAddress(alice, 10, 'bm90LWEtY3Vyc29y')).rejects.toBeInstanceOf(
      InvalidCursorError,
    );
  });

  it('resumes correctly from a cursor in the middle of a block', async () => {
    const page = await txQueries.listByAddress(alice, 50, encodeCursor(30n, 1));
    expect(page.items[0]).toMatchObject({ blockNumber: 30n, transactionIndex: 0 });
  });

  it('returns a transaction with its receipt, block and ordered logs', async () => {
    const [swap] = (await txQueries.listByAddress(alice, 1)).items;
    const detail = await txQueries.findByHash(swap!.hash);
    expect(detail?.receipt?.status).toBe(1);
    expect(detail?.logs.map((l) => l.address)).toEqual([token]);
    expect(await txQueries.findByHash(`0x${'00'.repeat(32)}`)).toBeNull();
  });
});
