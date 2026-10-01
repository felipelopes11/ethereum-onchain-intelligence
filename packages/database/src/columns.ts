import { bigint, customType, varchar } from 'drizzle-orm/pg-core';

/**
 * EVM uint256 stored as NUMERIC(78,0): 2^256 - 1 has 78 decimal digits.
 * Postgres returns NUMERIC as a string, which we parse straight into bigint so the
 * value never passes through a JavaScript Number.
 */
export const uint256 = customType<{ data: bigint; driverData: string }>({
  dataType: () => 'numeric(78, 0)',
  toDriver: (value) => value.toString(10),
  fromDriver: (value) => BigInt(value),
});

/** Block numbers and nonces fit in int8, but exceed Number.MAX_SAFE_INTEGER in theory. */
export const blockNumber = (name: string) => bigint(name, { mode: 'bigint' });

/** Lowercase 0x-prefixed 20-byte hex. See ADR-006 for text vs bytea. */
export const address = (name: string) => varchar(name, { length: 42 }).$type<`0x${string}`>();

/** Lowercase 0x-prefixed 32-byte hex. */
export const hash = (name: string) => varchar(name, { length: 66 }).$type<`0x${string}`>();

/** Arbitrary-length hex (calldata, log data). */
export const hexData = customType<{ data: `0x${string}`; driverData: string }>({
  dataType: () => 'text',
});
