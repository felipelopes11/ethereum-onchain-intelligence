'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { TransactionDetailDto } from '@eoi/shared';
import { Card, CopyButton, ErrorState, ExternalLink, HexLink, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { formatEth, formatGwei, formatTimestamp, groupDigits } from '@/lib/format';
import { DecodedCall } from './decoded-call';
import { EventCard } from './event-card';

const TX_TYPES: Record<number, string> = {
  0: 'Legacy',
  1: 'EIP-2930',
  2: 'EIP-1559',
  3: 'EIP-4844 (blob)',
  4: 'EIP-7702 (set code)',
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-line py-2 last:border-0 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-sm break-all">{children}</dd>
    </div>
  );
}

function Status({ tx }: { tx: TransactionDetailDto }) {
  if (tx.status === 'success') return <span className="font-medium text-good">✓ Success</span>;
  if (tx.status === 'reverted')
    return <span className="font-medium text-critical">✕ Reverted</span>;
  return <span className="text-muted">Unknown (receipt unavailable)</span>;
}

export function TransactionView({ hash }: { hash: string }) {
  const { data: tx, error } = useQuery({
    queryKey: ['tx', hash],
    queryFn: ({ signal }) => api.transaction(hash, signal),
  });
  if (error) return <ErrorState error={error} />;
  if (!tx) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-semibold uppercase tracking-wide text-muted">Transaction</h1>
          <Status tx={tx} />
          {tx.protocol && (
            <span className="rounded border border-line px-2 py-0.5 text-xs">
              {tx.protocol.name}
            </span>
          )}
          {tx.source === 'rpc' && (
            <span
              className="rounded bg-warn-bg px-2 py-0.5 text-xs text-warn-ink"
              title="This transaction is outside the indexed range"
            >
              Fetched live from RPC (not indexed)
            </span>
          )}
        </div>
        <p
          className="flex flex-wrap items-center gap-2 break-all font-mono text-base"
          data-testid="tx-heading"
        >
          {tx.hash}
          <CopyButton value={tx.hash} />
          <ExternalLink chainId={tx.chainId} kind="tx" value={tx.hash} />
        </p>
      </header>

      <Card title="Overview">
        <dl>
          <Row label="Block">
            <span className="tabular">{groupDigits(tx.blockNumber)}</span>
            {tx.confirmations && (
              <span className="ml-2 text-xs text-muted">
                {groupDigits(tx.confirmations)} confirmations
              </span>
            )}
          </Row>
          <Row label="Timestamp">{formatTimestamp(tx.timestamp)}</Row>
          <Row label="From">
            <HexLink value={tx.from} kind="address" short={false} />
          </Row>
          <Row label="To">
            {tx.to ? (
              <HexLink value={tx.to} kind="address" short={false} />
            ) : tx.contractCreated ? (
              <span>
                Contract creation →{' '}
                <HexLink value={tx.contractCreated} kind="address" short={false} />
              </span>
            ) : (
              '—'
            )}
          </Row>
          <Row label="Value">{formatEth(tx.value, 18)} ETH</Row>
          <Row label="Transaction fee">{tx.fee ? `${formatEth(tx.fee, 9)} ETH` : '—'}</Row>
          <Row label="Gas used / limit">
            <span className="tabular">
              {tx.gasUsed ? groupDigits(tx.gasUsed) : '—'} / {groupDigits(tx.gasLimit)}
            </span>
          </Row>
          <Row label="Gas price">
            {tx.effectiveGasPrice
              ? `${formatGwei(tx.effectiveGasPrice)} (effective)`
              : tx.gasPrice
                ? formatGwei(tx.gasPrice)
                : '—'}
            {tx.maxFeePerGas && (
              <span className="ml-2 text-xs text-muted">
                max {formatGwei(tx.maxFeePerGas)} · priority{' '}
                {tx.maxPriorityFeePerGas ? formatGwei(tx.maxPriorityFeePerGas) : '—'}
              </span>
            )}
          </Row>
          <Row label="Nonce · position">
            {tx.nonce} · index {tx.transactionIndex}
          </Row>
          <Row label="Type">{TX_TYPES[tx.type] ?? `Type ${tx.type}`}</Row>
        </dl>
      </Card>

      <Card title="Input data">
        <DecodedCall tx={tx} />
      </Card>

      <Card title={`Emitted events (${tx.events.length})`}>
        {tx.events.length === 0 ? (
          <p className="text-sm text-muted">This transaction emitted no logs.</p>
        ) : (
          <ol className="space-y-3">
            {tx.events.map((event) => (
              <EventCard key={event.logIndex} event={event} />
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
