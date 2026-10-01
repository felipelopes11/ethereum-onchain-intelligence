'use client';

import type { DecodedEventDto } from '@eoi/shared';
import { HexLink } from '@/components/ui';
import { formatAmount } from '@/lib/format';
import { ArgsTable } from './decoded-call';

function TransferSummary({ event }: { event: DecodedEventDto }) {
  return (
    <ul className="space-y-2">
      {event.transfer.map((t, i) => (
        <li key={i} className="grid gap-1 text-sm sm:grid-cols-[5rem_1fr]">
          <span className="text-muted">From</span>
          <HexLink value={t.from} kind="address" short={false} />
          <span className="text-muted">To</span>
          <HexLink value={t.to} kind="address" short={false} />
          {t.tokenId !== null && (
            <>
              <span className="text-muted">Token ID</span>
              <span className="font-mono text-[13px] break-all">{t.tokenId}</span>
            </>
          )}
          {t.amount && (
            <>
              <span className="text-muted">Amount</span>
              <span className="font-semibold" data-testid="transfer-amount">
                {formatAmount(t.amount.raw, t.standard === 'erc1155' ? 0 : t.amount.decimals)}{' '}
                {t.amount.symbol ?? 'units'}
                {t.amount.symbol && (
                  <span className="ml-1 text-xs font-normal text-muted">
                    (symbol self-declared by contract)
                  </span>
                )}
              </span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

export function EventCard({ event }: { event: DecodedEventDto }) {
  const isTransfer = event.transfer.length > 0;
  return (
    <li className="rounded-md border border-line p-3" data-testid="event-card">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">#{event.logIndex}</span>
        <span className="font-semibold">
          {event.status === 'decoded' ? event.name : 'Unknown event'}
        </span>
        {isTransfer && (
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] uppercase">
            {event.transfer[0]?.standard}
          </span>
        )}
        <span className="text-xs text-muted">emitted by</span>
        <HexLink value={event.address} kind="address" />
        {event.abiSource && (
          <span
            className="text-xs text-muted"
            title="The log layout matches this ABI; this alone does not prove which protocol emitted it"
          >
            · layout: {event.abiSource}
          </span>
        )}
      </div>
      <div className="mt-2">
        {isTransfer ? (
          <TransferSummary event={event} />
        ) : event.status === 'decoded' ? (
          <ArgsTable args={event.args} />
        ) : (
          <p className="text-sm text-ink-2">
            No known ABI matches topic0; the raw log is shown below without interpretation.
          </p>
        )}
      </div>
      <details className="mt-2" open={event.status === 'unknown'}>
        <summary className="cursor-pointer text-xs text-muted hover:text-ink">
          View raw event
        </summary>
        <dl className="mt-2 space-y-1 rounded bg-surface-2 p-2 font-mono text-[12px] break-all">
          {event.signature && (
            <div>
              <dt className="inline text-muted">signature: </dt>
              <dd className="inline">{event.signature}</dd>
            </div>
          )}
          {event.raw.topics.map((topic, i) => (
            <div key={i}>
              <dt className="inline text-muted">topic{i}: </dt>
              <dd className="inline">{topic}</dd>
            </div>
          ))}
          <div>
            <dt className="inline text-muted">data: </dt>
            <dd className="inline">{event.raw.data}</dd>
          </div>
        </dl>
      </details>
    </li>
  );
}
