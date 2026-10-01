import { getAddress, type Hex } from 'viem';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

export function normalizeAddress(address: string): Hex {
  return getAddress(address).toLowerCase() as Hex;
}

export function isZeroAddress(address: string): boolean {
  return address.toLowerCase() === ZERO_ADDRESS;
}

/**
 * An indexed `address` event parameter is a 32-byte word whose upper 12 bytes must be
 * zero. A non-zero prefix means the log does not actually follow the ABI we assumed
 * (or the emitting contract is malicious), so we reject it instead of truncating.
 */
export function topicToAddress(topic: Hex): Hex | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(topic)) return null;
  if (!/^0x0{24}/.test(topic)) return null;
  return `0x${topic.slice(26).toLowerCase()}`;
}

const DELEGATION_PREFIX = '0xef0100';

/**
 * EIP-7702: an EOA that set a delegation has code `0xef0100 || address` (23 bytes).
 * It is still an EOA (it signs transactions); the code only points at the delegate.
 */
export function parseDelegationDesignator(code: Hex | null): Hex | null {
  if (!code) return null;
  const lower = code.toLowerCase();
  if (lower.length !== 2 + 23 * 2 || !lower.startsWith(DELEGATION_PREFIX)) return null;
  return `0x${lower.slice(DELEGATION_PREFIX.length)}`;
}

export function selectorOf(input: Hex): Hex | null {
  return input.length >= 10 ? (input.slice(0, 10).toLowerCase() as Hex) : null;
}
