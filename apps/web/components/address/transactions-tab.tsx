'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import type { TransactionListItemDto } from '@eoi/shared';
import { EmptyState, ErrorState, HexLink, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { formatEth, formatRelative, formatTimestamp, groupDigits } from '@/lib/format';

const DIRECTION: Record<TransactionListItemDto['direction'], { label: string; className: string }> =
  {
    out: { label: 'OUT', className: 'text-[var(--series-out)]' },
    in: { label: 'IN', className: 'text-[var(--series-in)]' },
    self: { label: 'SELF', className: 'text-muted' },
  };

function Method({ tx }: { tx: TransactionListItemDto }) {
  if (tx.contractCreated) return <span className="text-ink-2">Contract creation</span>;
  if (!tx.selector) return <span className="text-ink-2">Transfer</span>;
  if (tx.functionName) return <span className="font-medium">{tx.functionName}</span>;
  return (
    <span className="font-mono text-muted" title="No known ABI for this selector">
      {tx.selector}
    </span>
  );
}

export function TransactionsTab({ address }: { address: string }) {
  const query = useInfiniteQuery({
    queryKey: ['transactions', address],
    queryFn: ({ pageParam, signal }) => api.transactions(address, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  if (query.error) return <ErrorState error={query.error} />;
  if (!query.data) return <Skeleton className="h-64" />;
  const items = query.data.pages.flatMap((p) => p.items);
  if (items.length === 0) return <EmptyState>No transactions in the indexed range.</EmptyState>;

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="tabular w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-line text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Hash</th>
            <th className="px-3 py-2 font-medium">Method</th>
            <th className="px-3 py-2 font-medium">Block</th>
            <th className="px-3 py-2 font-medium">Age</th>
            <th className="px-3 py-2 font-medium" />
            <th className="px-3 py-2 font-medium">Counterparty</th>
            <th className="px-3 py-2 text-right font-medium">Value (ETH)</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map((tx) => {
            const counterparty = tx.direction === 'in' ? tx.from : (tx.to ?? tx.contractCreated);
            return (
              <tr key={tx.hash} className="border-b border-line last:border-0 hover:bg-surface-2">
                <td className="px-3 py-2">
                  <HexLink value={tx.hash} kind="tx" />
                </td>
                <td className="px-3 py-2">
                  <Method tx={tx} />
                  {tx.protocol && (
                    <span className="ml-1.5 text-xs text-muted">{tx.protocol.name}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-ink-2">{groupDigits(tx.blockNumber)}</td>
                <td className="px-3 py-2 text-ink-2" title={formatTimestamp(tx.timestamp)}>
                  {formatRelative(tx.timestamp)}
                </td>
                <td
                  className={`px-3 py-2 text-xs font-semibold ${DIRECTION[tx.direction].className}`}
                >
                  {DIRECTION[tx.direction].label}
                </td>
                <td className="px-3 py-2">
                  {counterparty ? <HexLink value={counterparty} kind="address" /> : '—'}
                </td>
                <td className="px-3 py-2 text-right">{formatEth(tx.value, 6)}</td>
                <td className="px-3 py-2 text-xs">
                  {tx.status === 'success' ? (
                    <span className="text-good">✓ Success</span>
                  ) : tx.status === 'reverted' ? (
                    <span className="text-critical">✕ Reverted</span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {query.hasNextPage && (
        <div className="border-t border-line p-3 text-center">
          <button
            type="button"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="rounded-md border border-line px-4 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-60"
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load older transactions'}
          </button>
        </div>
      )}
    </div>
  );
}
