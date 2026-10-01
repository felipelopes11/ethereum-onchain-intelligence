'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import type { CoverageDto, EvidenceBasis } from '@eoi/shared';
import { ApiRequestError } from '@/lib/api';
import { explorerUrl } from '@/lib/explorer';
import { groupDigits, shortHex } from '@/lib/format';

export function Card({
  title,
  children,
  actions,
  className = '',
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-line bg-surface ${className}`}>
      {(title ?? actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`${label} ${value}`}
      className="rounded px-1 text-xs text-muted hover:text-ink"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? 'copied' : 'copy'}
    </button>
  );
}

/** Renders an address/hash as text; React escapes it, so on-chain strings can never inject markup. */
export function HexLink({
  value,
  kind,
  short = true,
}: {
  value: string;
  kind: 'address' | 'tx';
  short?: boolean;
}) {
  const href = kind === 'address' ? `/address/${value}` : `/tx/${value}`;
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[13px]">
      <Link href={href} className="text-accent-ink hover:underline" title={value}>
        {short ? shortHex(value) : value}
      </Link>
      <CopyButton value={value} />
    </span>
  );
}

export function ExternalLink({
  chainId,
  kind,
  value,
}: {
  chainId: number;
  kind: 'address' | 'tx' | 'block';
  value: string;
}) {
  const url = explorerUrl(chainId, kind, value);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-muted hover:text-ink"
    >
      verify on explorer ↗
    </a>
  );
}

const BASIS_STYLES: Record<EvidenceBasis, { label: string; className: string; hint: string }> = {
  observed: {
    label: 'Observed',
    className: 'border-good text-good',
    hint: 'Read directly from blocks, receipts, logs or chain state.',
  },
  inferred: {
    label: 'Inferred',
    className: 'border-accent text-accent-ink',
    hint: 'Derived deterministically from observed data.',
  },
  heuristic: {
    label: 'Heuristic',
    className: 'border-dashed border-ink-2 text-ink-2',
    hint: 'A rule of thumb. It can be wrong.',
  },
};

export function BasisBadge({ basis }: { basis: EvidenceBasis }) {
  const style = BASIS_STYLES[basis];
  return (
    <span
      title={style.hint}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${style.className}`}
    >
      {style.label}
    </span>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted" title={hint}>
        {label}
      </dt>
      <dd className="tabular mt-0.5 text-lg font-semibold">{value}</dd>
    </div>
  );
}

export function CoverageNote({ coverage }: { coverage: CoverageDto }) {
  if (coverage.fromBlock === null || coverage.toBlock === null) {
    return <p className="text-xs text-muted">The indexer has not processed any blocks yet.</p>;
  }
  return (
    <p className="text-xs text-muted">
      Based on indexed blocks {groupDigits(coverage.fromBlock)}–{groupDigits(coverage.toBlock)}.
      Activity outside this range is not included.
    </p>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof ApiRequestError ? error.message : 'Something went wrong.';
  return (
    <div role="alert" className="rounded-lg border border-critical/40 bg-surface p-4 text-sm">
      <p className="font-medium text-critical">Could not load data</p>
      <p className="mt-1 text-ink-2">{message}</p>
    </div>
  );
}

export function Skeleton({ className = 'h-24' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-lg bg-surface-2 ${className}`} />;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted">{children}</p>;
}
