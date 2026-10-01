'use client';

import { DataTable, Tooltip, useTooltip } from './chart-frame';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STEPS = [
  'var(--seq-1)',
  'var(--seq-2)',
  'var(--seq-3)',
  'var(--seq-4)',
  'var(--seq-5)',
  'var(--seq-6)',
];

/** Transaction frequency by UTC weekday and hour: a single-hue sequential scale. */
export function HourHeatmap({ matrix }: { matrix: number[][] }) {
  const { tooltip, show, hide } = useTooltip();
  const max = Math.max(1, ...matrix.flat());
  const color = (n: number) =>
    n === 0
      ? 'var(--seq-0)'
      : STEPS[Math.min(STEPS.length - 1, Math.floor((n / max) * STEPS.length))];
  const cell = 22;
  const left = 34;

  return (
    <div data-chart className="relative">
      <svg
        viewBox={`0 0 ${left + 24 * cell} ${7 * cell + 18}`}
        className="h-auto w-full"
        role="img"
        aria-label="Transactions by weekday and hour (UTC)"
      >
        {matrix.map((row, d) =>
          row.map((n, h) => (
            <rect
              key={`${d}-${h}`}
              x={left + h * cell + 1}
              y={d * cell + 1}
              width={cell - 2}
              height={cell - 2}
              rx={3}
              fill={color(n)}
              onMouseMove={(e) =>
                show(e, <>{`${DAYS[d]} ${String(h).padStart(2, '0')}:00 UTC — ${n} tx`}</>)
              }
              onMouseLeave={hide}
            />
          )),
        )}
        {DAYS.map((day, d) => (
          <text key={day} x={0} y={d * cell + 15} className="fill-[var(--ink-muted)] text-[10px]">
            {day}
          </text>
        ))}
        {[0, 6, 12, 18, 23].map((h) => (
          <text
            key={h}
            x={left + h * cell + cell / 2}
            y={7 * cell + 13}
            textAnchor="middle"
            className="fill-[var(--ink-muted)] text-[10px]"
          >
            {String(h).padStart(2, '0')}
          </text>
        ))}
      </svg>
      <div className="mt-1 flex items-center gap-1 text-[11px] text-muted">
        fewer
        {STEPS.map((s) => (
          <span key={s} aria-hidden className="h-2.5 w-4 rounded-sm" style={{ background: s }} />
        ))}
        more
      </div>
      <Tooltip state={tooltip} />
      <DataTable
        caption="Transactions by weekday and hour"
        headers={['Day', ...Array.from({ length: 24 }, (_, h) => String(h))]}
        rows={matrix.map((row, d) => [DAYS[d] ?? '', ...row])}
      />
    </div>
  );
}
