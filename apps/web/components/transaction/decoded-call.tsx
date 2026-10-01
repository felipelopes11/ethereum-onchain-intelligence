'use client';

import type { DecodedArgDto, JsonValue, TransactionDetailDto } from '@eoi/shared';
import { HexLink } from '@/components/ui';

function isAddress(value: JsonValue): value is string {
  return typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value);
}

export function ArgValue({ value }: { value: JsonValue }) {
  if (isAddress(value)) return <HexLink value={value} kind="address" short={false} />;
  if (Array.isArray(value)) {
    return (
      <ol className="space-y-0.5">
        {value.map((v, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-muted">[{i}]</span>
            <ArgValue value={v} />
          </li>
        ))}
      </ol>
    );
  }
  if (value !== null && typeof value === 'object') {
    return (
      <dl className="space-y-0.5">
        {Object.entries(value).map(([k, v]) => (
          <div key={k} className="flex flex-wrap gap-2">
            <dt className="text-muted">{k}:</dt>
            <dd className="min-w-0">
              <ArgValue value={v} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span className="font-mono text-[13px] break-all">{String(value)}</span>;
}

export function ArgsTable({ args }: { args: DecodedArgDto[] }) {
  if (args.length === 0) return <p className="text-sm text-muted">No arguments.</p>;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-muted">
        <tr>
          <th className="py-1 pr-3 font-medium">Name</th>
          <th className="py-1 pr-3 font-medium">Type</th>
          <th className="py-1 font-medium">Value</th>
        </tr>
      </thead>
      <tbody>
        {args.map((arg, i) => (
          <tr key={`${arg.name}-${i}`} className="border-t border-line align-top">
            <td className="py-1.5 pr-3 font-mono text-[13px]">{arg.name}</td>
            <td className="py-1.5 pr-3 font-mono text-[13px] text-muted">{arg.type}</td>
            <td className="py-1.5">
              <ArgValue value={arg.value} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RawInput({ input }: { input: string }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-muted hover:text-ink">
        Raw input ({(input.length - 2) / 2} bytes)
      </summary>
      <pre className="mt-2 max-h-48 overflow-auto rounded bg-surface-2 p-2 font-mono text-[12px] break-all whitespace-pre-wrap">
        {input}
      </pre>
    </details>
  );
}

export function DecodedCall({ tx }: { tx: TransactionDetailDto }) {
  const { decoded } = tx;
  if (decoded.status === 'empty') {
    return <p className="text-sm text-ink-2">No calldata: a plain value transfer.</p>;
  }
  if (decoded.status === 'unknown') {
    return (
      <div className="space-y-2 text-sm" data-testid="unknown-call">
        <p className="font-medium">Unknown contract interaction</p>
        <dl className="grid gap-1 sm:grid-cols-[8rem_1fr]">
          <dt className="text-muted">Contract</dt>
          <dd>
            {tx.to ? <HexLink value={tx.to} kind="address" short={false} /> : 'contract creation'}
          </dd>
          <dt className="text-muted">Selector</dt>
          <dd className="font-mono">{decoded.selector ?? '—'}</dd>
          <dt className="text-muted">Reason</dt>
          <dd className="text-ink-2">{decoded.reason}</dd>
        </dl>
        <RawInput input={tx.input} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-mono text-sm font-semibold">{decoded.signature}</span>
        <span className="font-mono text-xs text-muted">{decoded.selector}</span>
        <span className="text-xs text-muted">ABI: {decoded.abiSource}</span>
      </div>
      {decoded.abiSource.startsWith('ambiguous:') && (
        <p className="rounded-md bg-warn-bg px-3 py-2 text-xs text-warn-ink">
          This selector is shared by several standards and the target&apos;s standard is unknown, so
          argument names are not shown.
        </p>
      )}
      <ArgsTable args={decoded.args} />
      <RawInput input={tx.input} />
    </div>
  );
}
