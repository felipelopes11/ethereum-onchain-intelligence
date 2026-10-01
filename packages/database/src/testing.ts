import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { MIGRATIONS_FOLDER, type DatabaseHandle } from './client';
import * as schema from './schema';

/**
 * In-process Postgres (PGlite) with all migrations applied. Used by repository,
 * indexer and API tests so they exercise real SQL (constraints, cascades, numeric)
 * without requiring a Postgres server.
 */
export async function createTestDatabase(): Promise<DatabaseHandle> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return {
    db,
    ping: async () => {
      await client.query('SELECT 1');
    },
    close: () => client.close(),
  };
}

export * from './fixtures';
