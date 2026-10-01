import { encodeAbiParameters, stringToHex, toFunctionSelector, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';
import type { BlockchainProvider } from '../src/provider';
import { readTokenMetadata, sanitizeTokenString } from '../src/token-metadata';
import type { ContractReadCall, ContractReadResult } from '../src/types';

const TOKEN: Hex = '0x1111111111111111111111111111111111111111';

const SELECTORS = {
  name: toFunctionSelector('name()'),
  symbol: toFunctionSelector('symbol()'),
  decimals: toFunctionSelector('decimals()'),
  totalSupply: toFunctionSelector('totalSupply()'),
  supportsInterface: toFunctionSelector('supportsInterface(bytes4)'),
};

type Responses = Partial<Record<keyof typeof SELECTORS, Hex>>;

function fakeProvider(responses: Responses): BlockchainProvider {
  const read = (call: ContractReadCall): ContractReadResult => {
    const entry = Object.entries(SELECTORS).find(([, selector]) => call.data.startsWith(selector));
    const data = entry ? responses[entry[0] as keyof typeof SELECTORS] : undefined;
    return data ? { success: true, data } : { success: false, error: 'execution reverted' };
  };
  return {
    readContracts: (calls: readonly ContractReadCall[]) => Promise.resolve(calls.map(read)),
  } as unknown as BlockchainProvider;
}

const str = (value: string) => encodeAbiParameters([{ type: 'string' }], [value]);
const uint = (value: bigint) => encodeAbiParameters([{ type: 'uint256' }], [value]);

describe('readTokenMetadata', () => {
  it('reads a well-behaved ERC-20', async () => {
    const meta = await readTokenMetadata(
      fakeProvider({
        name: str('USD Coin'),
        symbol: str('USDC'),
        decimals: uint(6n),
        totalSupply: uint(10n ** 15n),
      }),
      TOKEN,
      'erc20',
    );
    expect(meta).toMatchObject({
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      totalSupply: 10n ** 15n,
      status: 'complete',
    });
  });

  it('supports legacy bytes32 name/symbol (e.g. MKR-style tokens)', async () => {
    const meta = await readTokenMetadata(
      fakeProvider({
        name: stringToHex('Maker', { size: 32 }),
        symbol: stringToHex('MKR', { size: 32 }),
        decimals: uint(18n),
        totalSupply: uint(1n),
      }),
      TOKEN,
      'erc20',
    );
    expect(meta).toMatchObject({ name: 'Maker', symbol: 'MKR', status: 'complete' });
  });

  it('records missing optional functions as null and marks metadata partial, never guessing', async () => {
    const meta = await readTokenMetadata(fakeProvider({ totalSupply: uint(5n) }), TOKEN, 'erc20');
    expect(meta).toMatchObject({
      name: null,
      symbol: null,
      decimals: null,
      totalSupply: 5n,
      status: 'partial',
    });
    expect(meta.errors.length).toBeGreaterThan(0);
  });

  it('rejects out-of-range decimals instead of truncating', async () => {
    const meta = await readTokenMetadata(fakeProvider({ decimals: uint(1000n) }), TOKEN, 'erc20');
    expect(meta.decimals).toBeNull();
  });

  it('does not require decimals for NFTs', async () => {
    const meta = await readTokenMetadata(
      fakeProvider({ name: str('Punks'), symbol: str('PNK') }),
      TOKEN,
      'erc721',
    );
    expect(meta.status).toBe('complete');
  });

  it('marks a contract with no metadata as failed', async () => {
    expect((await readTokenMetadata(fakeProvider({}), TOKEN, 'erc20')).status).toBe('failed');
  });
});

describe('sanitizeTokenString', () => {
  it('strips control and bidi-override characters used for spoofing', () => {
    expect(sanitizeTokenString('US‮DC\u0000', 32)).toBe('USDC');
    expect(sanitizeTokenString('  Wrapped\n\tEther  ', 128)).toBe('Wrapped Ether');
  });

  it('caps length by code points', () => {
    expect(sanitizeTokenString('🚀'.repeat(50), 32)).toBe('🚀'.repeat(32));
  });

  it('returns null for strings that are empty after cleaning', () => {
    expect(sanitizeTokenString('​\u0001', 32)).toBeNull();
  });

  it('leaves HTML as text: escaping happens at render time', () => {
    expect(sanitizeTokenString('<img src=x onerror=alert(1)>', 128)).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });
});
