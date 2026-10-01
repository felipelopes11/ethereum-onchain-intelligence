import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startHealthServer } from '../src/health-server';
import { IndexerMetrics } from '../src/metrics';

let server: Server | undefined;

afterEach(() => {
  server?.close();
});

async function get(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const { port } = server!.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe('indexer health server', () => {
  it('separates liveness from readiness', async () => {
    let now = 1_000_000;
    const metrics = new IndexerMetrics(
      () => ({ requests: 0, errors: 0, retries: 0, reverts: 0 }),
      () => now,
    );
    server = await startHealthServer(metrics, { port: 0, staleAfterMs: 60_000 });

    expect((await get('/health')).status).toBe(200);
    expect((await get('/ready')).status).toBe(503);

    metrics.recordHead(120n, 108n);
    metrics.recordBatch(100n, 10, 500, 0);
    expect((await get('/ready')).status).toBe(200);
    expect((await get('/metrics')).body).toMatchObject({
      currentBlock: '100',
      lag: '8',
      blocksPerSecond: 20,
    });

    now += 120_000;
    expect((await get('/ready')).status).toBe(503);
  });
});
