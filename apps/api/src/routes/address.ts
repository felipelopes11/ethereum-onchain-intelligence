import type { FastifyInstance } from 'fastify';
import { addressSchema, paginationSchema } from '@eoi/shared';
import { z } from 'zod';
import type { ApiContext } from '../context';
import { AddressService } from '../services/address-service';

const paramsSchema = z.object({ address: addressSchema });

export function registerAddressRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const service = new AddressService(ctx);
  const address = (params: unknown) => paramsSchema.parse(params).address;

  app.get('/api/address/:address', (request) => service.summary(address(request.params)));

  app.get('/api/address/:address/transactions', (request) =>
    service.transactionPage(address(request.params), paginationSchema.parse(request.query)),
  );

  app.get('/api/address/:address/tokens', (request) =>
    service.tokenHoldings(address(request.params)),
  );

  app.get('/api/address/:address/protocols', (request) =>
    service.protocols(address(request.params)),
  );

  app.get('/api/address/:address/activity', (request) => service.activity(address(request.params)));

  app.get('/api/address/:address/explain', (request) => service.explain(address(request.params)));
}
