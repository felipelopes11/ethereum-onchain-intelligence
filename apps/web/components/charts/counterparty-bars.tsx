'use client';

import Link from 'next/link';
import type { CounterpartyDto } from '@eoi/shared';
import { shortHex } from '@/lib/format';
import { DataTable } from './chart-frame';

function kindLabel(c: CounterpartyDto): string {
  if (c.protocol) return c.protocol.name;
  if (c.isContract === true) return 'contract';
  if (c.isContract === false) return 'EOA';
  return 'unknown type';
}

/** Interaction frequency per counterparty, as labelled horizontal bars (HTML, so text wraps). */
export function CounterpartyBars({ items }: { items: CounterpartyDto[] }) {
  if (items.length === 0)
    return <p className="text-sm text-muted">No counterparties in the indexed range.</p>;
  const max = Math.max(...items.map((i) => i.transactionCount));
  return (
    <div>
      <ul className="space-y-1.5">
        {items.slice(0, 12).map((c) => (
          <li
            key={c.address}
            className="grid grid-cols-[minmax(0,11rem)_1fr_3rem] items-center gap-3 text-xs"
          >
            <span className="truncate">
              <Link
                href={`/address/${c.address}`}
                className="font-mono text-accent-ink hover:underline"
                title={c.address}
              >
                {shortHex(c.address)}
              </Link>
              <span className="ml-1 text-muted">{c.label ?? kindLabel(c)}</span>
            </span>
            <span
              className="h-3 rounded-r-[4px] bg-[var(--series-out)]"
              style={{ width: `${Math.max(2, (c.transactionCount / max) * 100)}%` }}
            />
            <span className="tabular text-right text-ink-2">{c.transactionCount}</span>
          </li>
        ))}
      </ul>
      <DataTable
        caption="Counterparties by transaction count"
        headers={['Address', 'Type', 'Transactions']}
        rows={items.map((c) => [c.address, c.label ?? kindLabel(c), c.transactionCount])}
      />
    </div>
  );
}
