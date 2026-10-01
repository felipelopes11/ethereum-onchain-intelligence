import { describe, expect, it } from 'vitest';
import type { AddressActivitySummary } from '@eoi/database';
import { classify, DEFI_MIN_INTERACTIONS, HEAVY_USER_MIN_SENT } from '../src/analysis/heuristics';
import type { AnalysisInput } from '../src/analysis/types';
import { TtlCache } from '../src/cache';

const emptySummary: AddressActivitySummary = {
  sent: 0,
  received: 0,
  total: 0,
  firstSeen: null,
  lastSeen: null,
  contractsInteracted: 0,
  callsWithCalldata: 0,
  distinctTokens: 0,
  transfers: {
    erc20: { incoming: 0, outgoing: 0 },
    erc721: { incoming: 0, outgoing: 0 },
    erc1155: { incoming: 0, outgoing: 0 },
  },
};

function input(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    address: '0x0000000000000000000000000000000000000001',
    kind: 'eoa',
    kindSource: 'eth_getCode',
    kindCheckedAtBlock: 100n,
    delegatedTo: null,
    summary: emptySummary,
    protocolActions: [],
    contractActivity: null,
    token: null,
    coverage: { fromBlock: 1n, toBlock: 100n, updatedAt: null },
    ...overrides,
  };
}

const ids = (i: AnalysisInput) => classify(i).map((c) => c.id);

describe('classify', () => {
  it('only states the observed account type for an inactive EOA', () => {
    const [result] = classify(input());
    expect(result).toMatchObject({
      id: 'account-type',
      label: 'Externally owned account (EOA)',
      basis: 'observed',
    });
    expect(result?.evidence[0]).toEqual({
      description: 'eth_getCode returned empty bytecode at block',
      value: '100',
    });
  });

  it('makes no account-type claim when the type is unknown', () => {
    expect(ids(input({ kind: 'unknown', kindSource: null }))).toEqual([]);
  });

  it('requires a minimum number of DeFi interactions before claiming DeFi participation', () => {
    const below = input({
      protocolActions: [
        {
          protocolId: 'uniswap',
          protocolName: 'Uniswap',
          category: 'dex',
          action: 'swap',
          transactionCount: DEFI_MIN_INTERACTIONS - 1,
        },
      ],
    });
    expect(ids(below)).not.toContain('defi-participant');

    const above = input({
      protocolActions: [
        {
          protocolId: 'uniswap',
          protocolName: 'Uniswap',
          category: 'dex',
          action: 'swap',
          transactionCount: 2,
        },
        {
          protocolId: 'aave-v3',
          protocolName: 'Aave V3',
          category: 'lending',
          action: 'supply',
          transactionCount: 1,
        },
        {
          protocolId: 'uniswap',
          protocolName: 'Uniswap',
          category: 'dex',
          action: 'add-liquidity',
          transactionCount: 4,
        },
      ],
    });
    const defi = classify(above).find((c) => c.id === 'defi-participant');
    expect(defi?.label).toBe('Likely DeFi participant');
    expect(defi?.evidence).toEqual([
      { description: 'Interactions with known DeFi contracts', value: 7 },
      { description: 'Swap-related transactions', value: 2 },
      { description: 'Liquidity-related transactions', value: 4 },
      { description: 'Lending-related transactions', value: 1 },
      { description: 'Protocols', value: 'Aave V3, Uniswap' },
    ]);
  });

  it('flags heavy contract users only above both volume and ratio thresholds', () => {
    const busyButPlain = input({ summary: { ...emptySummary, sent: 100, callsWithCalldata: 10 } });
    expect(ids(busyButPlain)).not.toContain('heavy-contract-user');
    const fewCalls = input({
      summary: {
        ...emptySummary,
        sent: HEAVY_USER_MIN_SENT - 1,
        callsWithCalldata: HEAVY_USER_MIN_SENT - 1,
      },
    });
    expect(ids(fewCalls)).not.toContain('heavy-contract-user');
    const heavy = input({
      summary: { ...emptySummary, sent: 50, callsWithCalldata: 45, contractsInteracted: 6 },
    });
    expect(classify(heavy).find((c) => c.id === 'heavy-contract-user')?.evidence).toContainEqual({
      description: 'Share of contract calls',
      value: '90%',
    });
  });

  it('describes token contracts as inferred from event shape, with self-declared metadata', () => {
    const result = classify(
      input({
        kind: 'contract',
        kindSource: 'emitted-log',
        token: {
          standard: 'erc20',
          name: 'USD Coin',
          symbol: 'USDC',
          decimals: 6,
          metadataStatus: 'complete',
        },
        contractActivity: {
          logsEmitted: 10,
          transferEventsEmitted: 9,
          distinctCallers: 3,
          incomingCalls: 5,
          deployedContracts: 0,
        },
      }),
    );
    expect(result.find((c) => c.id === 'token-contract')).toMatchObject({
      basis: 'inferred',
      label: 'Likely ERC-20 token contract',
    });
    expect(result.find((c) => c.id === 'token-contract')?.rule).toMatch(/self-declared/);
  });

  it('every classification carries a rule and at least one piece of evidence', () => {
    const all = classify(
      input({
        summary: { ...emptySummary, sent: 50, callsWithCalldata: 50 },
        protocolActions: [
          {
            protocolId: 'uniswap',
            protocolName: 'Uniswap',
            category: 'dex',
            action: 'swap',
            transactionCount: 9,
          },
        ],
        contractActivity: {
          logsEmitted: 0,
          transferEventsEmitted: 0,
          distinctCallers: 0,
          incomingCalls: 0,
          deployedContracts: 2,
        },
      }),
    );
    expect(all.length).toBeGreaterThanOrEqual(4);
    for (const c of all) {
      expect(c.rule.length).toBeGreaterThan(20);
      expect(c.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe('TtlCache', () => {
  it('coalesces concurrent loads and expires entries', async () => {
    let now = 0;
    const cache = new TtlCache<number>(1_000, 10, () => now);
    let loads = 0;
    const load = () => {
      loads++;
      return Promise.resolve(loads);
    };
    expect(await Promise.all([cache.getOrLoad('k', load), cache.getOrLoad('k', load)])).toEqual([
      1, 1,
    ]);
    now = 999;
    expect(await cache.getOrLoad('k', load)).toBe(1);
    now = 1_000;
    expect(await cache.getOrLoad('k', load)).toBe(2);
  });

  it('does not cache failures', async () => {
    const cache = new TtlCache<number>(1_000);
    await expect(
      cache.getOrLoad('k', () => Promise.reject(new Error('rpc down'))),
    ).rejects.toThrow();
    expect(await cache.getOrLoad('k', () => Promise.resolve(5))).toBe(5);
  });

  it('evicts the oldest entry when full', () => {
    const cache = new TtlCache<number>(1_000, 2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });
});
