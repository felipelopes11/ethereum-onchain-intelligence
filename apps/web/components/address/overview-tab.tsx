'use client';

import { ActivityTimeline } from '@/components/charts/activity-timeline';
import { CounterpartyBars } from '@/components/charts/counterparty-bars';
import { HourHeatmap } from '@/components/charts/hour-heatmap';
import { RelationGraph } from '@/components/charts/relation-graph';
import { Card, ErrorState, Skeleton } from '@/components/ui';
import { useActivity } from './use-activity';

export function OverviewTab({ address }: { address: string }) {
  const { data, error } = useActivity(address);
  if (error) return <ErrorState error={error} />;
  if (!data) return <Skeleton className="h-72" />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Activity timeline" className="lg:col-span-2">
        <ActivityTimeline buckets={data.timeline} unit={data.timelineUnit} />
      </Card>
      <Card title="Most frequent counterparties">
        <CounterpartyBars items={data.counterparties} />
      </Card>
      <Card title="Transaction frequency (UTC weekday × hour)">
        <HourHeatmap matrix={data.hourOfWeek} />
      </Card>
      <Card title="Observed relationships" className="lg:col-span-2">
        <RelationGraph address={address} items={data.counterparties} coverage={data.coverage} />
      </Card>
    </div>
  );
}
