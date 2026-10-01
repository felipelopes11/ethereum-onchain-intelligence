'use client';

import { useRouter } from 'next/navigation';
import type { CounterpartyDto, CoverageDto } from '@eoi/shared';
import { groupDigits, shortHex } from '@/lib/format';
import { LegendItem, Tooltip, useTooltip } from './chart-frame';

const SIZE = 460;
const CENTER = SIZE / 2;
const RADIUS = 165;
const MAX_NODES = 12;

type NodeType = 'protocol' | 'contract' | 'eoa' | 'unknown';

const NODE_STYLE: Record<NodeType, { fill: string; label: string }> = {
  protocol: { fill: 'var(--series-3)', label: 'Known protocol contract' },
  contract: { fill: 'var(--series-out)', label: 'Other contract' },
  eoa: { fill: 'var(--ink-muted)', label: 'EOA' },
  unknown: { fill: 'transparent', label: 'Type not determined' },
};

function nodeType(c: CounterpartyDto): NodeType {
  if (c.protocol) return 'protocol';
  if (c.isContract === true) return 'contract';
  if (c.isContract === false) return 'eoa';
  return 'unknown';
}

/**
 * Radial graph of direct transaction relationships. It only draws edges observed in
 * indexed transactions (sender <-> recipient); it does not imply ownership or intent.
 */
export function RelationGraph({
  address,
  items,
  coverage,
}: {
  address: string;
  items: CounterpartyDto[];
  coverage: CoverageDto;
}) {
  const router = useRouter();
  const { tooltip, show, hide } = useTooltip();
  const nodes = items.slice(0, MAX_NODES);
  if (nodes.length === 0)
    return <p className="text-sm text-muted">No relationships in the indexed range.</p>;
  const max = Math.max(...nodes.map((n) => n.transactionCount));

  return (
    <div data-chart className="relative">
      <div className="mb-2 flex flex-wrap gap-4">
        {(Object.keys(NODE_STYLE) as NodeType[]).map((t) => (
          <LegendItem
            key={t}
            color={t === 'unknown' ? 'var(--axis)' : NODE_STYLE[t].fill}
            label={NODE_STYLE[t].label}
          />
        ))}
      </div>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="mx-auto h-auto w-full max-w-[460px]"
        role="img"
        aria-label="Observed transaction relationships"
      >
        {nodes.map((n, i) => {
          const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
          const x = CENTER + Math.cos(angle) * RADIUS;
          const y = CENTER + Math.sin(angle) * RADIUS;
          const type = nodeType(n);
          const width = 1 + (n.transactionCount / max) * 5;
          const anchor =
            Math.cos(angle) > 0.3 ? 'start' : Math.cos(angle) < -0.3 ? 'end' : 'middle';
          const dx = anchor === 'start' ? 14 : anchor === 'end' ? -14 : 0;
          const dy = anchor === 'middle' ? (Math.sin(angle) > 0 ? 24 : -16) : 4;
          return (
            <g
              key={n.address}
              className="cursor-pointer"
              onClick={() => router.push(`/address/${n.address}`)}
              onMouseMove={(e) =>
                show(
                  e,
                  <>
                    <div className="font-mono">{shortHex(n.address, 10, 8)}</div>
                    <div>{n.protocol ? n.protocol.name : NODE_STYLE[type].label}</div>
                    <div>{n.transactionCount} transactions</div>
                  </>,
                )
              }
              onMouseLeave={hide}
            >
              <line
                x1={CENTER}
                y1={CENTER}
                x2={x}
                y2={y}
                stroke="var(--axis)"
                strokeWidth={width}
                strokeLinecap="round"
              />
              <circle
                cx={x}
                cy={y}
                r={9}
                fill={NODE_STYLE[type].fill}
                stroke={type === 'unknown' ? 'var(--ink-muted)' : 'var(--surface)'}
                strokeWidth={2}
              />
              <text
                x={x + dx}
                y={y + dy}
                textAnchor={anchor}
                className="fill-[var(--ink-2)] text-[11px]"
              >
                {n.protocol ? n.protocol.name : (n.label ?? shortHex(n.address))}
              </text>
            </g>
          );
        })}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={14}
          fill="var(--ink)"
          stroke="var(--surface)"
          strokeWidth={3}
        />
        <text
          x={CENTER}
          y={CENTER + 32}
          textAnchor="middle"
          className="fill-[var(--ink)] font-mono text-[11px] font-semibold"
        >
          {shortHex(address)}
        </text>
      </svg>
      <Tooltip state={tooltip} />
      <p className="mt-2 text-xs text-muted">
        Edges are direct transactions between this address and each counterparty, observed in
        indexed blocks {coverage.fromBlock ? groupDigits(coverage.fromBlock) : '—'}–
        {coverage.toBlock ? groupDigits(coverage.toBlock) : '—'}. Width is proportional to
        transaction count. Only the top {MAX_NODES} counterparties are drawn. A relationship says
        nothing about ownership or intent.
      </p>
    </div>
  );
}
