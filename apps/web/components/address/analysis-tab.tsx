'use client';

import { useQuery } from '@tanstack/react-query';
import { BasisBadge, Card, CoverageNote, ErrorState, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { formatTimestamp } from '@/lib/format';

function List({ items, marker = '•' }: { items: string[]; marker?: string }) {
  return (
    <ul className="space-y-1 text-sm">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span aria-hidden className="text-muted">
            {marker}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** "Explain this wallet": renders the deterministic report exactly as the API produced it. */
export function AnalysisTab({ address }: { address: string }) {
  const { data, error } = useQuery({
    queryKey: ['explain', address],
    queryFn: ({ signal }) => api.explain(address, signal),
  });
  if (error) return <ErrorState error={error} />;
  if (!data) return <Skeleton className="h-96" />;

  return (
    <div className="space-y-4" data-testid="explain-report">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Explain this wallet</h2>
        <p className="text-xs text-muted">
          Generated {formatTimestamp(data.generatedAt)} · deterministic, no generative AI
        </p>
      </div>
      <CoverageNote coverage={data.coverage} />

      <Card title="Observed activity">
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {data.observedActivity.map((item) => (
            <div
              key={item.description}
              className="flex justify-between gap-4 border-b border-line py-1"
            >
              <dt className="text-ink-2">{item.description}</dt>
              <dd className="tabular font-medium">{item.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title="Classifications">
        {data.classifications.length === 0 ? (
          <p className="text-sm text-muted">No rule produced a classification for this address.</p>
        ) : (
          <ul className="space-y-4">
            {data.classifications.map((c) => (
              <li key={c.id} className="rounded-md border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{c.label}</span>
                  <BasisBadge basis={c.basis} />
                </div>
                <h3 className="mt-2 text-xs font-semibold uppercase text-muted">Evidence</h3>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {c.evidence.map((e) => (
                    <li key={e.description} className="flex justify-between gap-4">
                      <span className="text-ink-2">{e.description}</span>
                      <span className="tabular break-all text-right font-mono text-[13px]">
                        {e.value}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted">Rule: {c.rule}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Unknowns">
          <List items={data.unknowns} marker="?" />
        </Card>
        <Card title="Limitations">
          <List items={data.limitations} />
        </Card>
      </div>
      <Card title="Methodology">
        <List items={data.methodology} />
      </Card>
    </div>
  );
}
