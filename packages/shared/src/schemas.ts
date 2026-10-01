import { getAddress, isAddress } from 'viem';
import { z } from 'zod';

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
// ENS names are normalised (UTS-46) by the resolver; this pattern only gates obviously
// invalid input before any network call is made.
const ENS_PATTERN = /^(?=.{3,255}$)([a-z0-9-]{1,63}\.)+eth$/i;

export type Hex = `0x${string}`;

/** EIP-55: single-case hex carries no checksum; mixed case must match it exactly. */
function hasValidChecksumOrNone(address: string): boolean {
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  return isAddress(address, { strict: true });
}

/**
 * Accepts an address in any case. Mixed-case input must carry a valid EIP-55
 * checksum, which catches copy/paste typos instead of silently querying a
 * different account. Output is always lowercase (the canonical storage form).
 */
export const addressSchema = z
  .string()
  .trim()
  .regex(ADDRESS_PATTERN, 'Expected a 0x-prefixed 20-byte hex address')
  .refine(hasValidChecksumOrNone, 'Invalid EIP-55 checksum')
  .transform((value) => value.toLowerCase() as Hex);

export const txHashSchema = z
  .string()
  .trim()
  .regex(TX_HASH_PATTERN, 'Expected a 0x-prefixed 32-byte hex transaction hash')
  .transform((value) => value.toLowerCase() as Hex);

export const ensNameSchema = z
  .string()
  .trim()
  .regex(ENS_PATTERN, 'Expected an ENS name ending in .eth')
  .transform((value) => value.toLowerCase());

export type SearchTarget =
  | { type: 'address'; value: Hex }
  | { type: 'transaction'; value: Hex }
  | { type: 'ens'; value: string };

export type SearchParseResult = { ok: true; target: SearchTarget } | { ok: false; error: string };

/** Detects the type of a free-form search query. Pure: performs no I/O. */
export function parseSearchQuery(raw: string): SearchParseResult {
  const input = raw.trim();
  if (input.length === 0)
    return { ok: false, error: 'Enter an address, transaction hash or ENS name' };

  if (/^0x[0-9a-fA-F]{40}$/.test(input)) {
    const parsed = addressSchema.safeParse(input);
    return parsed.success
      ? { ok: true, target: { type: 'address', value: parsed.data } }
      : { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid address' };
  }
  if (/^0x[0-9a-fA-F]{64}$/.test(input)) {
    return { ok: true, target: { type: 'transaction', value: input.toLowerCase() as Hex } };
  }
  const ens = ensNameSchema.safeParse(input);
  if (ens.success) return { ok: true, target: { type: 'ens', value: ens.data } };

  if (input.startsWith('0x')) {
    return {
      ok: false,
      error: 'Hex input must be a 20-byte address or a 32-byte transaction hash',
    };
  }
  return {
    ok: false,
    error: 'Unrecognised input: expected an address, transaction hash or .eth name',
  };
}

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
  cursor: z
    .string()
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/, 'Invalid cursor')
    .optional(),
});
export type Pagination = z.infer<typeof paginationSchema>;

export function toChecksumAddress(address: string): Hex {
  return getAddress(address);
}
