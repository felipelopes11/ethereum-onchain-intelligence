import { and, count, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SEPOLIA } from '@eoi/shared';
import type { DatabaseHandle } from '../src/client';
import { IngestionRepository } from '../src/repositories/ingestion-repository';
import {
  addresses,
  blocks,
  contracts,
  logs,
  tokenTransfers,
  tokens,
  transactionReceipts,
  transactions,
} from '../src/schema';
import {
  blockHashFor,
  buildBlockBundle,
  buildChain,
  createTestDatabase,
  fakeAddress,
} from '../src/testing';

const CHAIN = SEPOLIA.id;
const alice = fakeAddress('alice');
const bob = fakeAddress('bob');
const token = fakeAddress('token');

let handle: DatabaseHandle;
let repo: IngestionRepository;

async function countRows(
  table: typeof blocks | typeof transactions | typeof logs | typeof tokenTransfers,
) {
  const [row] = await handle.db.select({ n: count() }).from(table);
  return row?.n ?? 0;
}

beforeEach(async () => {
  handle = await createTestDatabase();
  repo = new IngestionRepository(handle.db, CHAIN);
  await repo.ensureChain(SEPOLIA);
});

afterEach(async () => {
  await handle.close();
});

describe('IngestionRepository.persistBlocks', () => {
  it('persists a block with its transactions, receipts, logs and transfers atomically', async () => {
    const bundle = buildBlockBundle({
      chainId: CHAIN,
      number: 100n,
      transactions: [
        { from: alice, to: token, erc20Transfers: [{ token, from: alice, to: bob, value: 5n }] },
      ],
    });
    await repo.persistBlocks([bundle]);

    expect(await countRows(blocks)).toBe(1);
    expect(await countRows(transactions)).toBe(1);
    expect(await countRows(logs)).toBe(1);
    expect(await countRows(tokenTransfers)).toBe(1);
    expect(await repo.getCheckpoint()).toEqual({
      blockNumber: 100n,
      blockHash: bundle.block.hash,
      startBlock: 100n,
    });
  });

  it('round-trips uint256 values above Number.MAX_SAFE_INTEGER without precision loss', async () => {
    const huge = 2n ** 256n - 1n;
    const bundle = buildBlockBundle({
      chainId: CHAIN,
      number: 1n,
      transactions: [
        {
          from: alice,
          to: bob,
          value: huge,
          erc20Transfers: [{ token, from: alice, to: bob, value: huge }],
        },
      ],
    });
    await repo.persistBlocks([bundle]);

    const [tx] = await handle.db.select({ value: transactions.value }).from(transactions);
    const [transfer] = await handle.db.select({ value: tokenTransfers.value }).from(tokenTransfers);
    expect(tx?.value).toBe(huge);
    expect(transfer?.value).toBe(huge);
  });

  it('is idempotent: replaying the same batch after a crash creates no duplicates', async () => {
    const chain = buildChain(CHAIN, 10n, 14n, () => [
      { from: alice, to: token, erc20Transfers: [{ token, from: alice, to: bob, value: 1n }] },
    ]);
    await repo.persistBlocks(chain);
    await repo.persistBlocks(chain);
    await repo.persistBlocks(chain.slice(2));

    expect(await countRows(blocks)).toBe(5);
    expect(await countRows(transactions)).toBe(5);
    expect(await countRows(tokenTransfers)).toBe(5);
  });

  it('rolls back the whole batch if any row violates a constraint', async () => {
    const good = buildBlockBundle({ chainId: CHAIN, number: 1n });
    const bad = buildBlockBundle({ chainId: CHAIN, number: 2n });
    bad.block.hash = '0xNOT-A-HASH';
    await expect(repo.persistBlocks([good, bad])).rejects.toThrow();

    expect(await countRows(blocks)).toBe(0);
    expect(await repo.getCheckpoint()).toBeNull();
  });

  it('upgrades contract evidence and merges token interfaces across observations', async () => {
    const deployed = fakeAddress('deployed-token');
    await repo.persistBlocks([
      buildBlockBundle({
        chainId: CHAIN,
        number: 5n,
        transactions: [{ from: alice, to: null, deploys: deployed }],
      }),
    ]);
    await repo.persistBlocks([
      buildBlockBundle({
        chainId: CHAIN,
        number: 6n,
        transactions: [
          {
            from: alice,
            to: deployed,
            erc20Transfers: [{ token: deployed, from: alice, to: bob, value: 9n }],
          },
        ],
      }),
    ]);

    const [address] = await handle.db
      .select()
      .from(addresses)
      .where(eq(addresses.address, deployed));
    const [contract] = await handle.db
      .select()
      .from(contracts)
      .where(eq(contracts.address, deployed));
    expect(address).toMatchObject({
      kind: 'contract',
      kindSource: 'deployment-receipt',
      firstObservedBlock: 5n,
    });
    expect(contract).toMatchObject({ deployer: alice, deploymentBlock: 5n, interfaces: ['erc20'] });
  });

  it('keeps the earliest start block as the lower bound of coverage', async () => {
    await repo.persistBlocks(buildChain(CHAIN, 50n, 52n));
    await repo.persistBlocks(buildChain(CHAIN, 53n, 55n));
    expect((await repo.getCheckpoint())?.startBlock).toBe(50n);
  });
});

describe('IngestionRepository.rollbackTo', () => {
  it('removes orphaned blocks and every row derived from them via cascades', async () => {
    const lateToken = fakeAddress('late-token');
    await repo.persistBlocks(
      buildChain(CHAIN, 1n, 6n, (n) =>
        n >= 5n
          ? [
              {
                from: alice,
                to: lateToken,
                erc20Transfers: [{ token: lateToken, from: alice, to: bob, value: n }],
              },
            ]
          : [{ from: alice, to: bob }],
      ),
    );

    const { removedBlocks } = await repo.rollbackTo(4n);

    expect(removedBlocks).toBe(2);
    expect(await countRows(blocks)).toBe(4);
    expect(await countRows(transactions)).toBe(4);
    expect(await countRows(tokenTransfers)).toBe(0);
    const receipts = await handle.db.select({ n: count() }).from(transactionReceipts);
    expect(receipts[0]?.n).toBe(4);
    expect(await handle.db.select().from(tokens)).toEqual([]);
    expect(
      await handle.db
        .select()
        .from(addresses)
        .where(and(eq(addresses.chainId, CHAIN), eq(addresses.address, lateToken))),
    ).toEqual([]);
    expect(await repo.getCheckpoint()).toMatchObject({
      blockNumber: 4n,
      blockHash: blockHashFor(4n),
    });
  });

  it('allows the replacement fork to be persisted after rollback', async () => {
    await repo.persistBlocks(buildChain(CHAIN, 1n, 5n));
    await repo.rollbackTo(3n);
    const fork = buildChain(CHAIN, 4n, 5n, () => [], 'fork-b');
    fork[0]!.block.parentHash = blockHashFor(3n);
    await repo.persistBlocks(fork);

    expect(await repo.getStoredBlockHash(5n)).toBe(blockHashFor(5n, 'fork-b'));
  });

  it('clears the checkpoint when rolling back past the first indexed block', async () => {
    await repo.persistBlocks(buildChain(CHAIN, 10n, 12n));
    await repo.rollbackTo(5n);
    expect(await repo.getCheckpoint()).toBeNull();
    expect(await countRows(blocks)).toBe(0);
  });
});
