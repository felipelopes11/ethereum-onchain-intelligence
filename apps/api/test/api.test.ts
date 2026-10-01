import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AddressActivityDto,
  AddressSummaryDto,
  ApiErrorDto,
  ExplainReportDto,
  Paginated,
  TransactionDetailDto,
  TransactionListItemDto,
} from '@eoi/shared';
import {
  alice,
  bob,
  createHarness,
  rpcTransaction,
  stubProvider,
  SWAP_ROUTER,
  usdc,
  type Harness,
} from './harness';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

async function get<T>(
  url: string,
): Promise<{ status: number; body: T; headers: Record<string, unknown> }> {
  const res = await h.app.inject({ method: 'GET', url });
  return { status: res.statusCode, body: res.json<T>(), headers: res.headers };
}

describe('system endpoints', () => {
  it('separates liveness and readiness', async () => {
    expect((await get('/health')).body).toEqual({ status: 'ok' });
    const ready = await get<{ status: string; checks: Record<string, { ok: boolean }> }>('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.checks).toEqual({ database: { ok: true }, rpc: { ok: true } });
  });

  it('reports indexer status and lag', async () => {
    expect((await get('/api/status')).body).toMatchObject({
      lastProcessedBlock: '30',
      chainHead: '50',
      lag: '20',
    });
  });

  it('derives demo examples from currently indexed data', async () => {
    const { body } = await get<{ items: { kind: string; value: string }[] }>('/api/examples');
    expect(body.items.map((i) => i.kind)).toEqual([
      'protocol-user',
      'token-contract',
      'protocol-transaction',
      'token-transfer',
    ]);
    expect(body.items[0]?.value).toBe(alice);
  });

  it('returns JSON 404 for unknown routes', async () => {
    const res = await get<ApiErrorDto>('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/address/:address', () => {
  it('rejects malformed addresses and bad checksums with 400', async () => {
    expect((await get('/api/address/0x123')).status).toBe(400);
    const badChecksum = await get<ApiErrorDto>(
      '/api/address/0xd8Da6BF26964aF9D7eEd9e03E53415D37aA96045',
    );
    expect(badChecksum.status).toBe(400);
    expect(badChecksum.body.error.message).toMatch(/checksum/i);
  });

  it('aggregates indexed activity with coverage and live balance', async () => {
    const { status, body } = await get<AddressSummaryDto>(`/api/address/${alice}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      address: alice,
      kind: 'eoa',
      // Signing transactions is definitive EOA evidence; no bytecode heuristics needed.
      kindSource: 'transaction-sender',
      delegatedTo: null,
      balance: { wei: '1500000000000000000', blockNumber: '50' },
      nonce: 42,
      transactionCount: { sent: 45, received: 0, total: 45 },
      firstSeen: { blockNumber: '1' },
      lastSeen: { blockNumber: '30' },
      tokens: 1,
      transfers: { erc20: { incoming: 15, outgoing: 0 } },
      coverage: { chainId: 11155111, fromBlock: '1', toBlock: '30' },
    });
    expect(body.protocols).toEqual([
      expect.objectContaining({
        id: 'uniswap',
        transactionCount: 15,
        contracts: [{ address: SWAP_ROUTER, role: 'v3-swap-router-02' }],
      }),
    ]);
  });

  it('accepts checksummed input and normalises it', async () => {
    const { body } = await get<AddressSummaryDto>(
      `/api/address/${alice.toUpperCase().replace('0X', '0x')}`,
    );
    expect(body.address).toBe(alice);
  });

  it('shows labels and contract evidence for known protocol contracts', async () => {
    const { body } = await get<AddressSummaryDto>(`/api/address/${SWAP_ROUTER}`);
    expect(body.kind).toBe('contract');
    expect(body.labels).toEqual([
      { label: 'Uniswap: v3-swap-router-02', category: 'dex', source: 'protocol-registry:uniswap' },
    ]);
  });

  it('degrades gracefully when the RPC is down (indexed data still served, nothing guessed)', async () => {
    const down = () => Promise.reject(new Error('fetch failed'));
    const degraded = await createHarness(
      stubProvider({
        getBalance: down,
        getCode: down,
        getTransactionCount: down,
        getLatestBlockNumber: down,
      }),
    );
    try {
      const res = await degraded.app.inject({ method: 'GET', url: `/api/address/${bob}` });
      expect(res.statusCode).toBe(200);
      expect(res.json<AddressSummaryDto>()).toMatchObject({
        kind: 'unknown',
        balance: null,
        nonce: null,
        transactionCount: { received: 30 },
      });
    } finally {
      await degraded.close();
    }
  });
});

describe('EIP-7702 delegated accounts', () => {
  const delegate = '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b';
  const designator = `0xef0100${delegate.slice(2)}` as const;

  it('classifies an account with a delegation designator as an EOA, not a contract', async () => {
    const delegated = await createHarness(
      stubProvider({ getCode: () => Promise.resolve(designator) }),
    );
    try {
      // bob never signed a transaction, so only the bytecode can tell us what he is.
      const summary = (
        await delegated.app.inject({ method: 'GET', url: `/api/address/${bob}` })
      ).json<AddressSummaryDto>();
      expect(summary).toMatchObject({
        kind: 'eoa',
        kindSource: 'eth_getCode',
        delegatedTo: delegate,
      });
      const report = (
        await delegated.app.inject({ method: 'GET', url: `/api/address/${bob}/explain` })
      ).json<ExplainReportDto>();
      expect(report.classifications[0]).toMatchObject({
        label: 'Externally owned account (EOA) with EIP-7702 delegation',
        basis: 'observed',
      });
    } finally {
      await delegated.close();
    }
  });

  it('treats any transaction sender as an EOA even if it also has code', async () => {
    const withCode = await createHarness(
      stubProvider({ getCode: () => Promise.resolve('0x6080604052') }),
    );
    try {
      const summary = (
        await withCode.app.inject({ method: 'GET', url: `/api/address/${alice}` })
      ).json<AddressSummaryDto>();
      expect(summary).toMatchObject({ kind: 'eoa', kindSource: 'transaction-sender' });
    } finally {
      await withCode.close();
    }
  });
});

describe('address sub-resources', () => {
  it('paginates transactions with an opaque cursor', async () => {
    const first = await get<Paginated<TransactionListItemDto>>(
      `/api/address/${alice}/transactions?limit=10`,
    );
    expect(first.body.items).toHaveLength(10);
    expect(first.body.items[0]).toMatchObject({
      blockNumber: '30',
      direction: 'out',
      functionName: 'exactInputSingle',
      protocol: { id: 'uniswap' },
      status: 'success',
    });
    const second = await get<Paginated<TransactionListItemDto>>(
      `/api/address/${alice}/transactions?limit=10&cursor=${first.body.nextCursor}`,
    );
    // Page one ends mid-block 24 (two txs on even blocks); page two resumes inside it.
    expect(second.body.items[0]).toMatchObject({ blockNumber: '24', direction: 'out' });
    expect((await get(`/api/address/${alice}/transactions?cursor=bad!`)).status).toBe(400);
    expect((await get(`/api/address/${alice}/transactions?limit=5000`)).status).toBe(400);
  });

  it('reports token flows as observed net flow, not balances', async () => {
    const { body } = await get<{
      items: { token: { symbol: string }; netObserved: string; incoming: string }[];
    }>(`/api/address/${alice}/tokens`);
    expect(body.items).toEqual([
      expect.objectContaining({
        token: expect.objectContaining({ address: usdc, symbol: 'USDC', decimals: 6 }),
        incoming: '375000000',
        netObserved: '375000000',
      }),
    ]);
  });

  it('interprets protocol calls into actions', async () => {
    const { body } = await get<{ actions: { action: string; transactionCount: number }[] }>(
      `/api/address/${alice}/protocols`,
    );
    expect(body.actions).toEqual([
      expect.objectContaining({ protocolId: 'uniswap', action: 'swap', transactionCount: 15 }),
    ]);
  });

  it('returns activity buckets, counterparties and token flows', async () => {
    const { body } = await get<AddressActivityDto>(`/api/address/${alice}/activity`);
    expect(body.counterparties.map((c) => [c.address, c.transactionCount, c.isContract])).toEqual([
      [bob, 30, false],
      [SWAP_ROUTER, 15, true],
    ]);
    expect(body.hourOfWeek.flat().reduce((a, b) => a + b, 0)).toBe(45);
    expect(body.tokenFlows).toHaveLength(1);
  });
});

describe('GET /api/address/:address/explain', () => {
  it('produces a deterministic evidence-based report with explicit limitations', async () => {
    const first = await get<ExplainReportDto>(`/api/address/${alice}/explain`);
    const second = await get<ExplainReportDto>(`/api/address/${alice}/explain`);
    expect(first.body).toEqual(second.body);

    const defi = first.body.classifications.find((c) => c.id === 'defi-participant');
    expect(defi).toMatchObject({ label: 'Likely DeFi participant', basis: 'heuristic' });
    expect(defi?.evidence).toEqual(
      expect.arrayContaining([
        { description: 'Interactions with known DeFi contracts', value: 15 },
        { description: 'Swap-related transactions', value: 15 },
      ]),
    );
    expect(first.body.classifications.find((c) => c.id === 'account-type')).toMatchObject({
      basis: 'observed',
    });
    expect(first.body.unknowns).toEqual(
      expect.arrayContaining([expect.stringMatching(/Owner identity is unknown/)]),
    );
    expect(first.body.limitations.length).toBeGreaterThan(3);
    expect(first.body.coverage).toMatchObject({ fromBlock: '1', toBlock: '30' });
  });
});

describe('GET /api/transaction/:hash', () => {
  it('decodes calldata and events of an indexed transaction', async () => {
    const page = await get<Paginated<TransactionListItemDto>>(
      `/api/address/${alice}/transactions?limit=1`,
    );
    const { status, body } = await get<TransactionDetailDto>(
      `/api/transaction/${page.body.items[0]!.hash}`,
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      source: 'index',
      status: 'success',
      confirmations: '21',
      protocol: { id: 'uniswap' },
      decoded: {
        status: 'decoded',
        functionName: 'exactInputSingle',
        abiSource: 'uniswap-v3-swap-router-02',
      },
    });
    expect(body.events[0]).toMatchObject({
      status: 'decoded',
      name: 'Transfer',
      transfer: [
        {
          standard: 'erc20',
          from: SWAP_ROUTER,
          to: alice,
          amount: { symbol: 'USDC', decimals: 6, raw: '25000000' },
        },
      ],
      raw: { topics: expect.any(Array) },
    });
  });

  it('falls back to RPC for transactions outside the indexed range and says so', async () => {
    const hash = `0x${'ef'.repeat(32)}` as const;
    const { tx, receipt } = rpcTransaction(hash);
    const withRpc = await createHarness(
      stubProvider({
        getTransaction: () => Promise.resolve(tx),
        getTransactionReceipt: () => Promise.resolve(receipt),
        getLatestBlockNumber: () => Promise.resolve(1_000n),
      }),
    );
    try {
      const res = await withRpc.app.inject({ method: 'GET', url: `/api/transaction/${hash}` });
      expect(res.json<TransactionDetailDto>()).toMatchObject({
        source: 'rpc',
        decoded: { status: 'empty' },
        confirmations: '2',
      });
    } finally {
      await withRpc.close();
    }
  });

  it('returns 404 for unknown hashes and 400 for malformed ones', async () => {
    expect((await get(`/api/transaction/0x${'00'.repeat(32)}`)).status).toBe(404);
    expect((await get('/api/transaction/0xnothex')).status).toBe(400);
  });

  it('never leaks internal error details', async () => {
    const broken = await createHarness(
      stubProvider({
        getTransaction: () =>
          Promise.reject(new Error('connect ECONNREFUSED http://secret-rpc/key')),
      }),
    );
    try {
      const res = await broken.app.inject({
        method: 'GET',
        url: `/api/transaction/0x${'11'.repeat(32)}`,
      });
      expect(res.statusCode).toBe(500);
      expect(res.body).not.toContain('secret');
      expect(res.json<ApiErrorDto>().error).toEqual({
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    } finally {
      await broken.close();
    }
  });
});

describe('GET /api/search', () => {
  it('detects the input type', async () => {
    expect((await get(`/api/search?q=${alice}`)).body).toEqual({
      type: 'address',
      address: alice,
      ensName: null,
    });
    expect((await get(`/api/search?q=0x${'ab'.repeat(32)}`)).body).toEqual({
      type: 'transaction',
      hash: `0x${'ab'.repeat(32)}`,
    });
  });

  it('rejects junk and reports when ENS is not configured', async () => {
    expect((await get('/api/search?q=hello')).status).toBe(400);
    expect((await get(`/api/search?q=${'a'.repeat(300)}`)).status).toBe(400);
    expect((await get('/api/search?q=vitalik.eth')).status).toBe(501);
  });
});

describe('hardening', () => {
  it('rate limits per client', async () => {
    const limited = await createHarness(stubProvider(), {
      rateLimit: { max: 2, windowMs: 60_000 },
    });
    try {
      const codes = [];
      for (let i = 0; i < 3; i++)
        codes.push((await limited.app.inject({ method: 'GET', url: '/api/status' })).statusCode);
      expect(codes).toEqual([200, 200, 429]);
      // Health checks are exempt so orchestration keeps working under load.
      expect((await limited.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    } finally {
      await limited.close();
    }
  });

  it('sends security headers and restricts CORS to configured origins', async () => {
    const allowed = await h.app.inject({
      method: 'GET',
      url: '/api/status',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(allowed.headers['x-content-type-options']).toBe('nosniff');
    const denied = await h.app.inject({
      method: 'GET',
      url: '/api/status',
      headers: { origin: 'https://evil.test' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
