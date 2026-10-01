import type { FastifyError, FastifyInstance } from 'fastify';
import { InvalidCursorError } from '@eoi/database';
import type { ApiErrorDto } from '@eoi/shared';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const notFound = (message: string) => new ApiError(404, 'NOT_FOUND', message);
export const badRequest = (message: string) => new ApiError(400, 'BAD_REQUEST', message);

function body(code: string, message: string): ApiErrorDto {
  return { error: { code, message } };
}

/**
 * One error shape for every failure. Internal errors are logged with details but the
 * client only receives a generic message: stack traces, SQL and RPC URLs never leak.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send(body(error.code, error.message));
    }
    if (error instanceof ZodError) {
      const message = error.issues
        .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
        .join('; ');
      return reply.status(400).send(body('VALIDATION_ERROR', message));
    }
    if (error instanceof InvalidCursorError) {
      return reply.status(400).send(body('INVALID_CURSOR', error.message));
    }
    const statusCode = 'statusCode' in error ? error.statusCode : undefined;
    if (statusCode === 429) {
      return reply.status(429).send(body('RATE_LIMITED', 'Too many requests, slow down'));
    }
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send(body('BAD_REQUEST', error.message));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send(body('INTERNAL_ERROR', 'Internal server error'));
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send(body('NOT_FOUND', 'Route not found')),
  );
}
