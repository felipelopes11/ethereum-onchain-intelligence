import { describe, expect, it } from 'vitest';
import { ConfigError, apiEnvSchema, indexerEnvSchema, parseEnv, redactUrl } from './env';

const base = {
  DATABASE_URL: 'postgres://eoi:eoi@localhost:5432/eoi',
  ETHEREUM_RPC_URL: 'https://ethereum-sepolia-rpc.publicnode.com',
};

describe('parseEnv', () => {
  it('applies safe defaults for the indexer', () => {
    const env = parseEnv(indexerEnvSchema, base);
    expect(env.ETHEREUM_CHAIN_ID).toBe(11155111);
    expect(env.CONFIRMATIONS).toBe(12);
    expect(env.INDEXER_START_BLOCK).toEqual({ kind: 'offset', blocks: 500n });
  });

  it.each([
    ['latest', { kind: 'latest' }],
    ['-25', { kind: 'offset', blocks: 25n }],
    ['9000000', { kind: 'absolute', block: 9_000_000n }],
  ])('parses INDEXER_START_BLOCK=%s', (value, expected) => {
    expect(
      parseEnv(indexerEnvSchema, { ...base, INDEXER_START_BLOCK: value }).INDEXER_START_BLOCK,
    ).toEqual(expected);
  });

  it('treats empty strings as unset (copied .env.example)', () => {
    const env = parseEnv(indexerEnvSchema, {
      ...base,
      CONFIRMATIONS: '',
      INDEXER_START_BLOCK: ' ',
    });
    expect(env.CONFIRMATIONS).toBe(12);
  });

  it('reports every invalid variable at once', () => {
    try {
      parseEnv(indexerEnvSchema, { DATABASE_URL: 'mysql://x', ETHEREUM_RPC_URL: 'ws://x' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const issues = (error as ConfigError).issues.join('\n');
      expect(issues).toContain('DATABASE_URL');
      expect(issues).toContain('ETHEREUM_RPC_URL');
    }
  });

  it('rejects an unbounded batch size', () => {
    expect(() => parseEnv(indexerEnvSchema, { ...base, INDEXER_BATCH_SIZE: '100000' })).toThrow(
      ConfigError,
    );
  });

  it('splits CORS origins', () => {
    const env = parseEnv(apiEnvSchema, { ...base, CORS_ORIGIN: 'http://a.test, http://b.test' });
    expect(env.CORS_ORIGIN).toEqual(['http://a.test', 'http://b.test']);
  });
});

describe('redactUrl', () => {
  it('hides credentials and API keys embedded in RPC URLs', () => {
    expect(redactUrl('postgres://user:secret@db:5432/eoi')).toBe('postgres://***:***@db:5432/eoi');
    // Fake key used to prove redaction. secret-scan:allow
    const fakeKeyUrl = 'https://eth-sepolia.g.alchemy.com/v2/abcdefghijklmnopqrstuvwxyz'; // secret-scan:allow
    expect(redactUrl(fakeKeyUrl)).toBe('https://eth-sepolia.g.alchemy.com/***');
    expect(redactUrl('https://rpc.example/?apikey=secret')).toBe('https://rpc.example/?***');
  });

  it('does not throw on garbage', () => {
    expect(redactUrl('not a url')).toBe('***');
  });
});
