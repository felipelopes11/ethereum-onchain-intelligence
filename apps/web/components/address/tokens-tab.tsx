'use client';

import { useQuery } from '@tanstack/react-query';
import { TokenFlowChart } from '@/components/charts/token-flow';
import { Card, CoverageNote, EmptyState, ErrorState, HexLink, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { formatAmount, groupDigits } from '@/lib/format';
import { useActivity } from './use-activity';

export function TokensTab({ address }: { address: string }) {
  const tokens = useQuery({
    queryKey: ['tokens', address],
    queryFn: ({ signal }) => api.tokens(address, signal),
  });
  const activity = useActivity(address);

  if (tokens.error) return <ErrorState error={tokens.error} />;
  if (!tokens.data) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-warn-bg px-3 py-2 text-xs text-warn-ink">
        Net flow is computed only from transfers inside the indexed range. It is{' '}
        <strong>not a balance</strong>: transfers before the indexed range, mints without events,
        and rebasing tokens are not reflected.
      </div>
      <Card title="Token flow">
        {activity.data ? (
          <TokenFlowChart flows={activity.data.tokenFlows} />
        ) : (
          <Skeleton className="h-40" />
        )}
      </Card>
      <Card title="Tokens transferred">
        {tokens.data.items.length === 0 ? (
          <EmptyState>No token transfers in the indexed range.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">Token (self-declared)</th>
                  <th className="py-2 pr-3 font-medium">Standard</th>
                  <th className="py-2 pr-3 font-medium">Contract</th>
                  <th className="py-2 pr-3 text-right font-medium">Net observed flow</th>
                  <th className="py-2 pr-3 text-right font-medium">Transfers</th>
                  <th className="py-2 font-medium">Last block</th>
                </tr>
              </thead>
              <tbody>
                {tokens.data.items.map((item) => {
                  const decimals = item.standard === 'erc20' ? item.token.decimals : 0;
                  return (
                    <tr
                      key={`${item.token.address}-${item.standard}`}
                      className="border-t border-line"
                    >
                      <td className="py-2 pr-3">
                        {item.token.name ?? <span className="text-muted">unnamed</span>}
                        {item.token.symbol && (
                          <span className="ml-1 text-muted">({item.token.symbol})</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs uppercase text-ink-2">{item.standard}</td>
                      <td className="py-2 pr-3">
                        <HexLink value={item.token.address} kind="address" />
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {formatAmount(item.netObserved, decimals)}
                      </td>
                      <td className="py-2 pr-3 text-right">{item.transferCount}</td>
                      <td className="py-2 text-ink-2">{groupDigits(item.lastTransferBlock)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3">
          <CoverageNote coverage={tokens.data.coverage} />
        </div>
      </Card>
    </div>
  );
}
