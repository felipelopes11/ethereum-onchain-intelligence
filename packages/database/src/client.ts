import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import * as schema from './schema';

export type Schema = typeof schema;

/**
 * Driver-agnostic database handle. Production uses node-postgres; tests use PGlite
 * (real Postgres compiled to WASM). Both satisfy this type, so repositories never
 * depend on a specific driver.
 */
export type Database = PgDatabase<PgQueryResultHKT, Schema>;

export interface DatabaseHandle {
  db: Database;
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface CreateDatabaseOptions {
  maxConnections?: number;
  statementTimeoutMs?: number;
  applicationName?: string;
  /**
   * Called when an idle pooled connection fails (database restart, network blip). The
   * pool discards that client and opens a new one on the next query. Without a listener,
   * node-postgres emits an unhandled 'error' event and the whole process crashes.
   */
  onConnectionError?: (error: Error) => void;
}

function defaultConnectionErrorHandler(error: Error): void {
  console.error(`database connection error (pool will reconnect): ${error.message}`);
}

export function createDatabase(url: string, options: CreateDatabaseOptions = {}): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString: url,
    max: options.maxConnections ?? 10,
    application_name: options.applicationName ?? 'eoi',
    // Bounds the cost of any single query an API caller can trigger.
    statement_timeout: options.statementTimeoutMs ?? 10_000,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  pool.on('error', (error) => {
    (options.onConnectionError ?? defaultConnectionErrorHandler)(error);
  });
  const db = drizzle({ client: pool, schema });
  return {
    db,
    ping: async () => {
      await pool.query('SELECT 1');
    },
    close: () => pool.end(),
  };
}

/**
 * Resolved relative to this source file in development. Bundled apps (Docker) set
 * MIGRATIONS_DIR because the bundle no longer lives next to the SQL files.
 */
export const MIGRATIONS_FOLDER =
  process.env.MIGRATIONS_DIR ?? fileURLToPath(new URL('../drizzle', import.meta.url));

export async function runMigrations(
  url: string,
  migrationsFolder = MIGRATIONS_FOLDER,
): Promise<void> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
