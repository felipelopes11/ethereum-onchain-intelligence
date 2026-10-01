'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CoverageNote, EmptyState, ErrorState, HexLink, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { groupDigits } from '@/lib/format';

export function ProtocolsTab({ address }: { address: string }) {
  const { data, error } = useQuery({
    queryKey: ['protocols', address],
    queryFn: ({ signal }) => api.protocols(address, signal),
  });
  if (error) return <ErrorState error={error} />;
  if (!data) return <Skeleton className="h-48" />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-2">
        Protocols are detected only by calls to contract addresses in an explicit registry
        (currently Uniswap and Aave V3 on Sepolia). Calls to other contracts appear as unknown
        contract interactions.
      </p>
      {data.protocols.length === 0 ? (
        <Card>
          <EmptyState>No calls to known protocol contracts in the indexed range.</EmptyState>
        </Card>
      ) : (
        data.protocols.map((protocol) => {
          const actions = data.actions.filter((a) => a.protocolId === protocol.id);
          const byAction = new Map<string, number>();
          for (const a of actions)
            byAction.set(
              a.action ?? 'not interpreted',
              (byAction.get(a.action ?? 'not interpreted') ?? 0) + a.transactionCount,
            );
          return (
            <Card key={protocol.id} title={`${protocol.name} · ${protocol.category}`}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="tabular text-2xl font-semibold">{protocol.transactionCount}</p>
                  <p className="text-xs text-muted">
                    transactions · blocks {groupDigits(protocol.firstBlock)}–
                    {groupDigits(protocol.lastBlock)}
                  </p>
                  <h3 className="mt-3 text-xs font-semibold uppercase text-muted">
                    Contracts called
                  </h3>
                  <ul className="mt-1 space-y-1 text-sm">
                    {protocol.contracts.map((c) => (
                      <li key={c.address} className="flex items-center gap-2">
                        <HexLink value={c.address} kind="address" />
                        <span className="text-xs text-muted">{c.role}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase text-muted">
                    Interpreted actions
                  </h3>
                  <ul className="mt-1 space-y-1 text-sm">
                    {[...byAction].map(([action, count]) => (
                      <li
                        key={action}
                        className="flex justify-between gap-4 border-b border-line py-1"
                      >
                        <span className={action === 'not interpreted' ? 'text-muted' : ''}>
                          {action}
                        </span>
                        <span className="tabular">{count}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted">
                    Actions are derived from the decoded function name only, not from outcomes.
                  </p>
                </div>
              </div>
            </Card>
          );
        })
      )}
      <CoverageNote coverage={data.coverage} />
    </div>
  );
}
