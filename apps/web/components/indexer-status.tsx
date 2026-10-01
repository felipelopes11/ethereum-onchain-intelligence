'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { groupDigits } from '@/lib/format';

export function IndexerStatusBadge() {
  const { data, isError } = useQuery({
    queryKey: ['status'],
    queryFn: ({ signal }) => api.status(signal),
    refetchInterval: 15_000,
  });
  if (isError) {
    return <span className="text-xs text-critical">API offline</span>;
  }
  if (!data) return <span className="text-xs text-muted">connecting…</span>;
  return (
    <span
      className="tabular hidden items-center gap-2 text-xs sm:inline-flex"
      title="Last block persisted by the indexer"
    >
      <span aria-hidden className="h-2 w-2 rounded-full bg-good" />
      {data.chainName} · indexed to #
      {data.lastProcessedBlock ? groupDigits(data.lastProcessedBlock) : '—'}
      {data.lag !== null && <span className="text-muted">({data.lag} behind head)</span>}
    </span>
  );
}
