'use client';

import Link from 'next/link';
import type { TokenFlowDto } from '@eoi/shared';
import { formatAmount, shortHex } from '@/lib/format';
import { DataTable, LegendItem, Tooltip, useTooltip } from './chart-frame';

function tokenName(flow: TokenFlowDto): string {
  return flow.token.symbol ?? shortHex(flow.token.address);
}

function amount(raw: string, flow: TokenFlowDto): string {
  if (flow.standard === 'erc721') return `${raw} NFT${raw === '1' ? '' : 's'}`;
  return `${formatAmount(raw, flow.standard === 'erc1155' ? 0 : flow.token.decimals)} ${tokenName(flow)}`;
}

/**
 * Diverging bars of transfer counts per token: outgoing to the left, incoming to the
 * right. Counts (not amounts) share one scale across tokens with different decimals.
 */
export function TokenFlowChart({ flows }: { flows: TokenFlowDto[] }) {
  const { tooltip, show, hide } = useTooltip();
  if (flows.length === 0)
    return <p className="text-sm text-muted">No token transfers in the indexed range.</p>;
  const shown = flows.slice(0, 10);
  const max = Math.max(1, ...shown.map((f) => Math.max(f.incomingCount, f.outgoingCount)));

  return (
    <div data-chart className="relative">
      <div className="mb-2 flex gap-4">
        <LegendItem color="var(--series-out)" label="Sent (transfer count)" />
        <LegendItem color="var(--series-in)" label="Received (transfer count)" />
      </div>
      <ul className="space-y-1.5">
        {shown.map((f) => (
          <li
            key={`${f.token.address}-${f.standard}`}
            className="grid grid-cols-[minmax(0,8rem)_1fr_1fr] items-center gap-2 text-xs"
            onMouseMove={(e) =>
              show(
                e,
                <>
                  <div className="font-medium">
                    {tokenName(f)} <span className="text-muted">({f.standard.toUpperCase()})</span>
                  </div>
                  <div>
                    Sent {f.outgoingCount}× · {amount(f.outgoing, f)}
                  </div>
                  <div>
                    Received {f.incomingCount}× · {amount(f.incoming, f)}
                  </div>
                </>,
              )
            }
            onMouseLeave={hide}
          >
            <Link
              href={`/address/${f.token.address}`}
              className="truncate text-accent-ink hover:underline"
              title={f.token.address}
            >
              {tokenName(f)}
            </Link>
            <span className="flex justify-end border-r border-[var(--axis)] pr-[1px]">
              {f.outgoingCount > 0 && (
                <span
                  className="h-3 rounded-l-[4px] bg-[var(--series-out)]"
                  style={{ width: `${(f.outgoingCount / max) * 100}%` }}
                />
              )}
            </span>
            <span className="flex">
              {f.incomingCount > 0 && (
                <span
                  className="h-3 rounded-r-[4px] bg-[var(--series-in)]"
                  style={{ width: `${(f.incomingCount / max) * 100}%` }}
                />
              )}
            </span>
          </li>
        ))}
      </ul>
      <Tooltip state={tooltip} />
      <p className="mt-2 text-xs text-muted">
        Token symbols are self-declared by each contract; verify the contract address.
      </p>
      <DataTable
        caption="Token flows"
        headers={[
          'Token',
          'Standard',
          'Sent (count)',
          'Sent (amount)',
          'Received (count)',
          'Received (amount)',
        ]}
        rows={flows.map((f) => [
          tokenName(f),
          f.standard,
          f.outgoingCount,
          amount(f.outgoing, f),
          f.incomingCount,
          amount(f.incoming, f),
        ])}
      />
    </div>
  );
}
