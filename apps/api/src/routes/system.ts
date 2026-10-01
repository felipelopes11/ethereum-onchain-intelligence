import type { FastifyInstance } from 'fastify';
import { describeError } from '@eoi/blockchain';
import { ExampleQueries, IngestionRepository } from '@eoi/database';
import { parseSearchQuery, type IndexerStatusDto, type SearchResultDto } from '@eoi/shared';
import { z } from 'zod';
import type { ApiContext } from '../context';
import { ApiError, badRequest, notFound } from '../errors';

const searchSchema = z.object({ q: z.string().max(256) });

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function registerSystemRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const ingestion = new IngestionRepository(ctx.db, ctx.chain.id);
  const examples = new ExampleQueries(ctx.db, ctx.chain.id);

  // Liveness: the process is up and the event loop responds. No dependencies checked,
  // so a database outage does not make the orchestrator restart healthy API pods.
  app.get('/health', { config: { rateLimit: false } }, () => ({ status: 'ok' }));

  // Readiness: dependencies needed to serve traffic are reachable.
  app.get('/ready', { config: { rateLimit: false } }, async (_request, reply) => {
    const checks: Record<string, { ok: boolean; error?: string }> = {};
    try {
      await withTimeout(ctx.pingDatabase(), 2_000);
      checks.database = { ok: true };
    } catch (error) {
      checks.database = { ok: false, error: describeError(error) };
    }
    try {
      await withTimeout(
        ctx.caches.head.getOrLoad('head', () => ctx.provider.getLatestBlockNumber()),
        3_000,
      );
      checks.rpc = { ok: true };
    } catch (error) {
      checks.rpc = { ok: false, error: describeError(error) };
    }
    // The API can serve indexed data without RPC (degraded), so only the database gates readiness.
    const ready = checks.database.ok;
    return reply.status(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not-ready', checks });
  });

  app.get('/api/status', async (): Promise<IndexerStatusDto & { chainName: string }> => {
    const checkpoint = await ingestion.getCheckpoint();
    let head: bigint | null = null;
    try {
      head = await ctx.caches.head.getOrLoad('head', () => ctx.provider.getLatestBlockNumber());
    } catch (error) {
      ctx.logger.warn({ err: describeError(error) }, 'could not read chain head');
    }
    return {
      chainId: ctx.chain.id,
      chainName: ctx.chain.name,
      lastProcessedBlock: checkpoint?.blockNumber.toString() ?? null,
      lastProcessedHash: checkpoint?.blockHash ?? null,
      chainHead: head?.toString() ?? null,
      lag: head !== null && checkpoint ? (head - checkpoint.blockNumber).toString() : null,
      updatedAt: null,
      confirmations: null,
    };
  });

  app.get('/api/examples', async () => ({ items: await examples.pick() }));

  app.get('/api/search', async (request): Promise<SearchResultDto> => {
    const { q } = searchSchema.parse(request.query);
    const parsed = parseSearchQuery(q);
    if (!parsed.ok) throw badRequest(parsed.error);
    const { target } = parsed;
    if (target.type === 'address') return { type: 'address', address: target.value, ensName: null };
    if (target.type === 'transaction') return { type: 'transaction', hash: target.value };

    if (!ctx.ens)
      throw new ApiError(
        501,
        'ENS_UNAVAILABLE',
        'ENS resolution is not configured (set ENS_RPC_URL)',
      );
    const resolver = ctx.ens;
    let resolved: `0x${string}` | null;
    try {
      resolved = await withTimeout(resolver.resolveName(target.value), 5_000);
    } catch (error) {
      ctx.logger.warn({ name: target.value, err: describeError(error) }, 'ENS resolution failed');
      throw new ApiError(502, 'ENS_ERROR', 'ENS resolution failed');
    }
    if (!resolved) throw notFound(`${target.value} does not resolve to an address`);
    return { type: 'address', address: resolved, ensName: target.value };
  });
}
