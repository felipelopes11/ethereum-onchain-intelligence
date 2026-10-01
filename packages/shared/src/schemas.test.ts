import { describe, expect, it } from 'vitest';
import { addressSchema, paginationSchema, parseSearchQuery, txHashSchema } from './schemas';
import { toJsonValue } from './serialization';

const CHECKSUMMED = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const BAD_CHECKSUM = '0xd8Da6BF26964aF9D7eEd9e03E53415D37aA96045';
const TX_HASH = `0x${'ab'.repeat(32)}`;

describe('addressSchema', () => {
  it('normalises a valid checksummed address to lowercase', () => {
    expect(addressSchema.parse(CHECKSUMMED)).toBe(CHECKSUMMED.toLowerCase());
  });

  it('accepts all-lowercase and all-uppercase addresses (no checksum encoded)', () => {
    expect(addressSchema.safeParse(CHECKSUMMED.toLowerCase()).success).toBe(true);
    expect(addressSchema.safeParse(`0x${CHECKSUMMED.slice(2).toUpperCase()}`).success).toBe(true);
  });

  it('rejects mixed-case input with an invalid EIP-55 checksum', () => {
    const result = addressSchema.safeParse(BAD_CHECKSUM);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/checksum/i);
  });

  it.each(['0x123', `0x${'g'.repeat(40)}`, CHECKSUMMED.slice(2), `${CHECKSUMMED}00`])(
    'rejects malformed address %s',
    (input) => {
      expect(addressSchema.safeParse(input).success).toBe(false);
    },
  );
});

describe('txHashSchema', () => {
  it('accepts and lowercases a 32-byte hash', () => {
    expect(txHashSchema.parse(TX_HASH.toUpperCase().replace('0X', '0x'))).toBe(TX_HASH);
  });

  it('rejects a hash of the wrong length', () => {
    expect(txHashSchema.safeParse(TX_HASH.slice(0, -2)).success).toBe(false);
  });
});

describe('parseSearchQuery', () => {
  it('detects addresses', () => {
    expect(parseSearchQuery(`  ${CHECKSUMMED} `)).toEqual({
      ok: true,
      target: { type: 'address', value: CHECKSUMMED.toLowerCase() },
    });
  });

  it('detects transaction hashes', () => {
    expect(parseSearchQuery(TX_HASH)).toEqual({
      ok: true,
      target: { type: 'transaction', value: TX_HASH },
    });
  });

  it('detects ENS names', () => {
    expect(parseSearchQuery('Vitalik.eth')).toEqual({
      ok: true,
      target: { type: 'ens', value: 'vitalik.eth' },
    });
  });

  it('surfaces the checksum error instead of guessing', () => {
    const result = parseSearchQuery(BAD_CHECKSUM);
    expect(result.ok).toBe(false);
  });

  it.each(['', '   ', '0x1234', 'hello world', 'foo.com', '<script>.eth'])(
    'rejects %j',
    (input) => {
      expect(parseSearchQuery(input).ok).toBe(false);
    },
  );
});

describe('paginationSchema', () => {
  it('applies defaults and coerces query-string numbers', () => {
    expect(paginationSchema.parse({})).toEqual({ limit: 25 });
    expect(paginationSchema.parse({ limit: '10' }).limit).toBe(10);
  });

  it('bounds the page size to protect the database', () => {
    expect(paginationSchema.safeParse({ limit: '1000' }).success).toBe(false);
    expect(paginationSchema.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('rejects cursors with characters outside base64url', () => {
    expect(paginationSchema.safeParse({ cursor: "1'; DROP TABLE blocks;--" }).success).toBe(false);
  });
});

describe('toJsonValue', () => {
  it('serialises uint256 values without precision loss', () => {
    const max = 2n ** 256n - 1n;
    expect(toJsonValue({ amount: max, list: [1n, 'x'] })).toEqual({
      amount: max.toString(),
      list: ['1', 'x'],
    });
  });
});
