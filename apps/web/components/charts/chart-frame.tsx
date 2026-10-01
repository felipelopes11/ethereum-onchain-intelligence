'use client';

import { useState, type ReactNode } from 'react';

export interface TooltipState {
  x: number;
  y: number;
  content: ReactNode;
}

/** Positions a tooltip inside a relatively positioned chart container. */
export function useTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const show = (
    event: { clientX: number; clientY: number; currentTarget: Element },
    content: ReactNode,
  ) => {
    const container = event.currentTarget.closest('[data-chart]');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top, content });
  };
  return { tooltip, show, hide: () => setTooltip(null) };
}

export function Tooltip({ state }: { state: TooltipState | null }) {
  if (!state) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 min-w-36 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg"
      style={{ left: state.x, top: state.y }}
    >
      {state.content}
    </div>
  );
}

export function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

/** Every chart ships a data table so no information depends on colour or hover alone. */
export function DataTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer text-muted hover:text-ink">View data as table</summary>
      <div className="mt-2 max-h-64 overflow-auto">
        <table className="tabular w-full text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="text-muted">
            <tr>
              {headers.map((h) => (
                <th key={h} className="py-1 pr-4 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-line">
                {row.map((cell, j) => (
                  <td key={j} className="py-1 pr-4 font-mono">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}
