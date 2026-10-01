import type { FastifyInstance } from 'fastify';
import { txHashSchema } from '@eoi/shared';
import { z } from 'zod';
import type { ApiContext } from '../context';
import { notFound } from '../errors';
import { TransactionService } from '../services/transaction-service';

const paramsSchema = z.object({ hash: txHashSchema });

export function registerTransactionRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const service = new TransactionService(ctx);

  app.get('/api/transaction/:hash', async (request) => {
    const { hash } = paramsSchema.parse(request.params);
    const transaction = await service.get(hash);
    if (!transaction) throw notFound(`Transaction ${hash} not found on chain ${ctx.chain.id}`);
    return transaction;
  });
}
