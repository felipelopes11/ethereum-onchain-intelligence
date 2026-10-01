/**
 * Zero-install local database for development: PGlite (Postgres compiled to WASM)
 * exposed over the Postgres wire protocol, persisted under .data/pglite.
 *
 * Use it when Docker is not available. It is a development convenience, NOT a
 * production database: it multiplexes all clients over a single Postgres session.
 * `docker compose up` runs a real PostgreSQL server instead.
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const port = Number(process.env.LOCAL_PG_PORT ?? 5432);
const dataDir = resolve(process.env.LOCAL_PG_DATA_DIR ?? '.data/pglite');
mkdirSync(dataDir, { recursive: true });

const db = await PGlite.create({ dataDir });
// Connections are multiplexed onto one session, so they are cheap; the cap must exceed
// the sum of all pools (API 10 + indexer 10 + scripts) or bursts get disconnected.
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 100 });
await server.start();

console.log(`Local Postgres (PGlite) listening on 127.0.0.1:${port}`);
console.log(`Data directory: ${dataDir}`);
console.log(`DATABASE_URL=postgres://postgres:postgres@127.0.0.1:${port}/postgres`);

const shutdown = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
