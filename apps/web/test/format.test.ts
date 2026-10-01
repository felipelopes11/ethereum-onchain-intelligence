import { describe, expect, it } from 'vitest';
import { formatAmount, formatEth, groupDigits, shortHex } from '@/lib/format';
import { searchDestination } from '@/components/search-box';

describe('formatAmount', () => {
  it('formats token amounts with decimals and grouping', () => {
    expect(formatAmount('1250000000', 6)).toBe('1,250');
    expect(formatAmount('28580000', 6)).toBe('28.58');
  });

  it('never loses precision on uint256-sized values', () => {
    const max = (2n ** 256n - 1n).toString();
    expect(formatAmount(max, 0)).toBe(groupDigits(max));
    expect(formatAmount(max, 0).replace(/,/g, '')).toBe(max);
  });

  it('does not render tiny non-zero amounts as zero', () => {
    expect(formatEth('1')).toBe('<0.000001');
    expect(formatEth('0')).toBe('0');
  });

  it('marks amounts of tokens with unknown decimals as raw units', () => {
    expect(formatAmount('1000', null)).toBe('1,000 (raw units)');
  });
});

describe('shortHex', () => {
  it('keeps both ends of an address', () => {
    expect(shortHex('0x440d4935489dab4d84197947dc0c014c125ceb22')).toBe('0x440d…eb22');
  });
});

describe('searchDestination', () => {
  it('routes addresses and transaction hashes to their pages', () => {
    expect(searchDestination('0x440D4935489dab4d84197947dc0c014c125ceb22'.toLowerCase())).toEqual({
      href: '/address/0x440d4935489dab4d84197947dc0c014c125ceb22',
    });
    expect(searchDestination(`0x${'ab'.repeat(32)}`)).toEqual({ href: `/tx/0x${'ab'.repeat(32)}` });
  });

  it('defers ENS names to the API and rejects junk with a message', () => {
    expect(searchDestination('vitalik.eth')).toEqual({ ens: 'vitalik.eth' });
    expect(searchDestination('not an address')).toHaveProperty('error');
    expect(searchDestination('0xd8Da6BF26964aF9D7eEd9e03E53415D37aA96045')).toEqual({
      error: 'Invalid EIP-55 checksum',
    });
  });
});
