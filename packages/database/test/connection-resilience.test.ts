import { createServer } from 'node:net';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '../src/client';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('no port'));
      });
    });
  });
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

describe('createDatabase connection resilience', () => {
  it('survives the database dropping idle connections and reconnects afterwards', async () => {
    const db = new PGlite();
    const port = await freePort();
    let server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 10 });
    await server.start();

    const errors: Error[] = [];
    const handle: DatabaseHandle = createDatabase(
      `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
      {
        maxConnections: 2,
        onConnectionError: (error) => errors.push(error),
      },
    );
    cleanups.push(async () => {
      await handle.close().catch(() => undefined);
      await server.stop().catch(() => undefined);
      await db.close().catch(() => undefined);
    });

    await handle.ping();

    // The server goes away while the pooled connection is idle. Before the fix this
    // emitted an unhandled 'error' event on the pool and crashed the process.
    await server.stop();
    await expect.poll(() => errors.length, { timeout: 5_000 }).toBeGreaterThan(0);

    server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 10 });
    await server.start();
    await expect(handle.ping()).resolves.toBeUndefined();
  }, 20_000);
});
