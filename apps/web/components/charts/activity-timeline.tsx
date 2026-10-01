'use client';

import type { ActivityBucketDto } from '@eoi/shared';
import { DataTable, LegendItem, niceMax, Tooltip, useTooltip } from './chart-frame';

const WIDTH = 720;
const HEIGHT = 180;
const PAD = { top: 12, right: 8, bottom: 24, left: 36 };

function label(start: string, unit: 'hour' | 'day'): string {
  return unit === 'hour' ? `${start.slice(5, 10)} ${start.slice(11, 16)}` : start.slice(0, 10);
}

/** Stacked bars: outgoing (blue) and incoming (orange) transactions per bucket. */
export function ActivityTimeline({
  buckets,
  unit,
}: {
  buckets: ActivityBucketDto[];
  unit: 'hour' | 'day';
}) {
  const { tooltip, show, hide } = useTooltip();
  if (buckets.length === 0)
    return <p className="text-sm text-muted">No transactions in the indexed range.</p>;

  const max = niceMax(Math.max(...buckets.map((b) => b.outgoing + b.incoming)));
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotW / buckets.length;
  const barW = Math.max(2, Math.min(28, slot - 2));
  const y = (v: number) => (v / max) * plotH;
  const labelEvery = Math.ceil(buckets.length / 6);

  return (
    <div data-chart className="relative">
      <div className="mb-2 flex gap-4">
        <LegendItem color="var(--series-out)" label="Sent" />
        <LegendItem color="var(--series-in)" label="Received" />
        <span className="text-xs text-muted">per {unit} (UTC)</span>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Transactions per ${unit}`}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={PAD.top + plotH - f * plotH}
              y2={PAD.top + plotH - f * plotH}
              stroke="var(--grid)"
            />
            <text
              x={PAD.left - 6}
              y={PAD.top + plotH - f * plotH + 4}
              textAnchor="end"
              className="fill-[var(--ink-muted)] text-[10px]"
            >
              {Math.round(max * f)}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const outH = y(b.outgoing);
          const inH = y(b.incoming);
          const base = PAD.top + plotH;
          // 2px surface gap between the stacked segments.
          const gap = outH > 0 && inH > 0 ? 2 : 0;
          return (
            <g
              key={b.start}
              onMouseMove={(e) =>
                show(
                  e,
                  <>
                    <div className="font-medium">{label(b.start, unit)}</div>
                    <div>Sent: {b.outgoing}</div>
                    <div>Received: {b.incoming}</div>
                  </>,
                )
              }
              onMouseLeave={hide}
            >
              <rect
                x={PAD.left + i * slot}
                y={PAD.top}
                width={slot}
                height={plotH}
                fill="transparent"
              />
              {outH > 0 && (
                <rect
                  x={x}
                  y={base - outH}
                  width={barW}
                  height={outH}
                  rx={Math.min(2, barW / 2)}
                  fill="var(--series-out)"
                />
              )}
              {inH > 0 && (
                <rect
                  x={x}
                  y={base - outH - inH - gap}
                  width={barW}
                  height={inH}
                  rx={Math.min(2, barW / 2)}
                  fill="var(--series-in)"
                />
              )}
              {i % labelEvery === 0 && (
                <text
                  x={x + barW / 2}
                  y={HEIGHT - 6}
                  textAnchor="middle"
                  className="fill-[var(--ink-muted)] text-[10px]"
                >
                  {label(b.start, unit)}
                </text>
              )}
            </g>
          );
        })}
        <line
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={PAD.top + plotH}
          y2={PAD.top + plotH}
          stroke="var(--axis)"
        />
      </svg>
      <Tooltip state={tooltip} />
      <DataTable
        caption="Transactions per bucket"
        headers={[unit === 'hour' ? 'Hour (UTC)' : 'Day (UTC)', 'Sent', 'Received']}
        rows={buckets.map((b) => [label(b.start, unit), b.outgoing, b.incoming])}
      />
    </div>
  );
}
