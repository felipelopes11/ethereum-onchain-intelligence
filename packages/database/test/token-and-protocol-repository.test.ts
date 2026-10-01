import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SEPOLIA } from '@eoi/shared';
import type { DatabaseHandle } from '../src/client';
import { IngestionRepository } from '../src/repositories/ingestion-repository';
import { ProtocolRepository } from '../src/repositories/protocol-repository';
import { TokenRepository } from '../src/repositories/token-repository';
import { contracts, protocolContracts, walletLabels } from '../src/schema';
import { buildBlockBundle, createTestDatabase, fakeAddress } from '../src/testing';

const CHAIN = SEPOLIA.id;
const token = fakeAddress('token');
const alice = fakeAddress('alice');

let handle: DatabaseHandle;

beforeEach(async () => {
  handle = await createTestDatabase();
  const ingestion = new IngestionRepository(handle.db, CHAIN);
  await ingestion.ensureChain(SEPOLIA);
  await ingestion.persistBlocks([
    buildBlockBundle({
      chainId: CHAIN,
      number: 1n,
      transactions: [
        { from: alice, to: token, erc20Transfers: [{ token, from: alice, to: alice, value: 1n }] },
      ],
    }),
  ]);
});

afterEach(async () => {
  await handle.close();
});

describe('TokenRepository', () => {
  it('queues newly observed tokens for metadata and records the result', async () => {
    const repo = new TokenRepository(handle.db, CHAIN);
    expect(await repo.findPendingMetadata(10)).toEqual([{ address: token, standard: 'erc20' }]);

    await repo.updateMetadata(token, {
      name: 'Test Token',
      symbol: 'TST',
      decimals: 18,
      totalSupply: 10n ** 27n,
      status: 'complete',
      error: null,
      declaredInterfaces: ['erc1155'],
    });

    expect(await repo.findPendingMetadata(10)).toEqual([]);
    const [stored] = await repo.findByAddresses([token]);
    expect(stored).toMatchObject({
      symbol: 'TST',
      decimals: 18,
      totalSupply: 10n ** 27n,
      metadataStatus: 'complete',
    });
    const [contract] = await handle.db.select().from(contracts).where(eq(contracts.address, token));
    expect(contract?.interfaces).toEqual(['erc20', 'erc1155']);
  });

  it('truncates oversized error messages instead of failing the update', async () => {
    const repo = new TokenRepository(handle.db, CHAIN);
    await repo.updateMetadata(token, {
      name: null,
      symbol: null,
      decimals: null,
      totalSupply: null,
      status: 'failed',
      error: 'x'.repeat(10_000),
      declaredInterfaces: [],
    });
    const [stored] = await repo.findByAddresses([token]);
    expect(stored?.metadataError).toHaveLength(256);
  });
});

describe('ProtocolRepository.sync', () => {
  const router = fakeAddress('router');
  const pool = fakeAddress('pool');

  it('mirrors registry contracts and labels idempotently, removing dropped contracts', async () => {
    const repo = new ProtocolRepository(handle.db, CHAIN);
    const definition = {
      id: 'dex',
      name: 'Dex',
      category: 'dex' as const,
      website: 'https://dex.test',
      contracts: [
        { address: router, role: 'router' },
        { address: pool, role: 'pool' },
      ],
    };
    await repo.sync([definition]);
    await repo.sync([definition]);
    expect(await handle.db.select().from(protocolContracts)).toHaveLength(2);
    expect(await handle.db.select().from(walletLabels)).toHaveLength(2);

    await repo.sync([{ ...definition, contracts: [{ address: router, role: 'router-v2' }] }]);
    const remaining = await handle.db.select().from(protocolContracts);
    expect(remaining).toEqual([expect.objectContaining({ address: router, role: 'router-v2' })]);
    const labels = await handle.db.select().from(walletLabels);
    expect(labels.map((l) => [l.label, l.source])).toEqual([
      ['Dex: router-v2', 'protocol-registry:dex'],
    ]);
  });
});
