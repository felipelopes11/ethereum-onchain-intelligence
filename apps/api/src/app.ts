import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { ApiContext } from './context';
import { registerErrorHandler } from './errors';
import { registerAddressRoutes } from './routes/address';
import { registerSystemRoutes } from './routes/system';
import { registerTransactionRoutes } from './routes/transaction';

export interface AppOptions {
  corsOrigins: string[];
  rateLimit: { max: number; windowMs: number };
  trustProxy: boolean;
  logger?: FastifyBaseLogger;
}

export async function buildApp(ctx: ApiContext, options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    ...(options.logger ? { loggerInstance: options.logger } : { logger: false }),
    // Only read endpoints exist; a tiny body limit removes a whole class of DoS vectors.
    bodyLimit: 1024,
    // X-Forwarded-For is only honoured behind a trusted proxy, otherwise clients could
    // spoof their IP and dodge rate limiting.
    trustProxy: options.trustProxy,
    requestTimeout: 30_000,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: options.corsOrigins, methods: ['GET'] });
  await app.register(rateLimit, {
    global: true,
    max: options.rateLimit.max,
    timeWindow: options.rateLimit.windowMs,
  });

  // Serialize bigint defensively: any value that slips through stays a decimal string.
  app.setReplySerializer((payload) =>
    JSON.stringify(payload, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  );
  app.addHook('onSend', async (request, reply) => {
    if (request.method === 'GET' && request.url.startsWith('/api/') && reply.statusCode === 200) {
      reply.header('cache-control', 'public, max-age=5');
    }
  });

  registerErrorHandler(app);
  registerSystemRoutes(app, ctx);
  registerAddressRoutes(app, ctx);
  registerTransactionRoutes(app, ctx);
  return app;
}
