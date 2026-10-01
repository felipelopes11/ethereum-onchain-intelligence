'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AddressSummaryDto } from '@eoi/shared';
import {
  ErrorState,
  ExternalLink,
  CopyButton,
  Skeleton,
  Stat,
  CoverageNote,
} from '@/components/ui';
import { api } from '@/lib/api';
import { formatEth, formatRelative, formatTimestamp, groupDigits } from '@/lib/format';
import { AnalysisTab } from './analysis-tab';
import { OverviewTab } from './overview-tab';
import { ProtocolsTab } from './protocols-tab';
import { TokensTab } from './tokens-tab';
import { TransactionsTab } from './transactions-tab';

const TABS = ['Overview', 'Transactions', 'Tokens', 'Protocols', 'Analysis'] as const;
type Tab = (typeof TABS)[number];

function KindBadge({ summary }: { summary: AddressSummaryDto }) {
  const text =
    summary.kind === 'contract'
      ? 'Contract'
      : summary.kind === 'eoa'
        ? summary.delegatedTo
          ? 'EOA · EIP-7702 delegated'
          : 'EOA'
        : 'Type unknown';
  return (
    <span
      data-testid="kind-badge"
      className="rounded border border-line bg-surface-2 px-2 py-0.5 text-xs font-medium"
      title={`Evidence: ${summary.kindSource ?? 'none'}`}
    >
      {text}
    </span>
  );
}

export function AddressView({ address }: { address: `0x${string}` }) {
  const [tab, setTab] = useState<Tab>('Overview');
  const summary = useQuery({
    queryKey: ['address', address],
    queryFn: ({ signal }) => api.address(address, signal),
  });

  if (summary.isError) return <ErrorState error={summary.error} />;
  const data = summary.data;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-sm font-semibold uppercase tracking-wide text-muted">Address</h1>
          {data && <KindBadge summary={data} />}
          {data?.labels.map((l) => (
            <span
              key={`${l.label}-${l.source}`}
              className="rounded border border-line px-2 py-0.5 text-xs"
              title={`Source: ${l.source}`}
            >
              {l.label}
            </span>
          ))}
        </div>
        <p
          className="flex flex-wrap items-center gap-2 break-all font-mono text-base sm:text-lg"
          data-testid="address-heading"
        >
          {address}
          <CopyButton value={address} />
          {data && <ExternalLink chainId={data.chainId} kind="address" value={address} />}
        </p>
        {data?.ensName && (
          <p className="text-sm text-ink-2">
            ENS reverse record: <span className="font-medium">{data.ensName}</span>{' '}
            <span className="text-muted">(set by the owner; resolved on Ethereum mainnet)</span>
          </p>
        )}
        {data?.delegatedTo && (
          <p className="text-sm text-ink-2">
            Account code is an EIP-7702 delegation to{' '}
            <span className="font-mono">{data.delegatedTo}</span>.
          </p>
        )}
      </header>

      {!data ? (
        <Skeleton className="h-28" />
      ) : (
        <section className="rounded-lg border border-line bg-surface p-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <Stat
              label="Balance (live)"
              value={data.balance ? `${formatEth(data.balance.wei, 4)} ETH` : 'unavailable'}
              hint={
                data.balance
                  ? `eth_getBalance at block ${data.balance.blockNumber}`
                  : 'RPC call failed'
              }
            />
            <Stat
              label="Nonce (all history)"
              value={data.nonce ?? '—'}
              hint="eth_getTransactionCount: transactions ever sent"
            />
            <Stat
              label="Indexed transactions"
              value={groupDigits(String(data.transactionCount.total))}
              hint={`${data.transactionCount.sent} sent · ${data.transactionCount.received} received`}
            />
            <Stat
              label="Contracts called"
              value={data.contractsInteracted}
              hint="Distinct recipients with on-chain contract evidence"
            />
            <Stat
              label="First seen"
              value={data.firstSeen ? formatRelative(data.firstSeen.timestamp) : '—'}
              hint={
                data.firstSeen
                  ? `${formatTimestamp(data.firstSeen.timestamp)} · block ${data.firstSeen.blockNumber}`
                  : undefined
              }
            />
            <Stat
              label="Last seen"
              value={data.lastSeen ? formatRelative(data.lastSeen.timestamp) : '—'}
              hint={
                data.lastSeen
                  ? `${formatTimestamp(data.lastSeen.timestamp)} · block ${data.lastSeen.blockNumber}`
                  : undefined
              }
            />
            <Stat label="Token contracts" value={data.tokens} />
            <Stat
              label="Known protocols"
              value={
                data.protocols.length === 0 ? 'none' : data.protocols.map((p) => p.name).join(', ')
              }
            />
          </dl>
          <div className="mt-4">
            <CoverageNote coverage={data.coverage} />
          </div>
        </section>
      )}

      <div>
        <div
          role="tablist"
          aria-label="Address sections"
          className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line [scrollbar-width:none]"
        >
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap ${
                tab === t
                  ? 'border-accent font-semibold text-ink'
                  : 'border-transparent text-ink-2 hover:text-ink'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="pt-5">
          {tab === 'Overview' && <OverviewTab address={address} />}
          {tab === 'Transactions' && <TransactionsTab address={address} />}
          {tab === 'Tokens' && <TokensTab address={address} />}
          {tab === 'Protocols' && <ProtocolsTab address={address} />}
          {tab === 'Analysis' && <AnalysisTab address={address} />}
        </div>
      </div>
    </div>
  );
}
