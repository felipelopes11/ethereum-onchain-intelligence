'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { shortHex } from '@/lib/format';

export function Examples() {
  const { data, isError } = useQuery({
    queryKey: ['examples'],
    queryFn: ({ signal }) => api.examples(signal),
  });
  if (isError || !data || data.items.length === 0) return null;
  return (
    <section aria-labelledby="examples-heading" className="mx-auto max-w-3xl">
      <h2
        id="examples-heading"
        className="text-xs font-semibold uppercase tracking-wide text-muted"
      >
        Try something currently in the index
      </h2>
      <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface">
        {data.items.map((item) => {
          const href = item.value.length === 66 ? `/tx/${item.value}` : `/address/${item.value}`;
          return (
            <li key={`${item.kind}-${item.value}`}>
              <Link
                href={href}
                className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm hover:bg-surface-2"
              >
                <span className="text-ink-2">{item.description}</span>
                <span className="shrink-0 font-mono text-[13px] text-accent-ink">
                  {shortHex(item.value, 8, 6)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
