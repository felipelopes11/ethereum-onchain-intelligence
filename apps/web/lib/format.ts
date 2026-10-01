import { formatUnits } from 'viem';

/** Formats a uint256 decimal string with token decimals, without passing through Number. */
export function formatAmount(raw: string, decimals: number | null, maxFraction = 6): string {
  if (decimals === null) return `${groupDigits(raw)} (raw units)`;
  const [whole = '0', fraction = ''] = formatUnits(BigInt(raw), decimals).split('.');
  const trimmed = fraction.slice(0, maxFraction).replace(/0+$/, '');
  const grouped = groupDigits(whole);
  if (trimmed.length > 0) return `${grouped}.${trimmed}`;
  // Non-zero values smaller than the display precision must not render as "0".
  return fraction.length > 0 && /[1-9]/.test(fraction)
    ? `<${grouped}.${'0'.repeat(maxFraction - 1)}1`
    : grouped;
}

export function formatEth(wei: string, maxFraction = 6): string {
  return formatAmount(wei, 18, maxFraction);
}

/** Thousands separators on a decimal integer string of any size. */
export function groupDigits(value: string): string {
  const negative = value.startsWith('-');
  const digits = negative ? value.slice(1) : value;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return negative ? `-${grouped}` : grouped;
}

export function shortHex(value: string, head = 6, tail = 4): string {
  return value.length <= head + tail + 2 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatGwei(wei: string): string {
  return `${formatAmount(wei, 9, 4)} gwei`;
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

export function formatRelative(iso: string, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 0) return 'in the future';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`;
}
