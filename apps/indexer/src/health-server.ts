import { createServer, type Server } from 'node:http';
import type { IndexerMetrics } from './metrics';

export interface HealthServerOptions {
  port: number;
  /** Ready only if the indexer made progress (or confirmed it is at head) this recently. */
  staleAfterMs: number;
}

/**
 * Minimal operational endpoint for container orchestration:
 *   /health  liveness  - the process is running and serving requests
 *   /ready   readiness - the indexer loop succeeded recently (RPC and DB reachable)
 *   /metrics JSON snapshot of indexer counters
 */
export async function startHealthServer(
  metrics: IndexerMetrics,
  options: HealthServerOptions,
): Promise<Server> {
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'GET') {
      send(405, { error: 'method not allowed' });
      return;
    }
    switch (req.url) {
      case '/health':
        send(200, { status: 'ok' });
        return;
      case '/ready': {
        const sinceSuccess = metrics.msSinceLastSuccess();
        const ready = sinceSuccess !== null && sinceSuccess < options.staleAfterMs;
        send(ready ? 200 : 503, {
          status: ready ? 'ready' : 'not-ready',
          msSinceLastSuccess: sinceSuccess,
        });
        return;
      }
      case '/metrics':
        send(200, metrics.snapshot());
        return;
      default:
        send(404, { error: 'not found' });
    }
  });
  // Surface EADDRINUSE and similar as a rejected promise instead of an unhandled event.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}
