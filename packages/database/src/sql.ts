import type { SQL } from 'drizzle-orm';
import type { Database } from './client';

/**
 * Runs a raw (parameterised) query and returns its rows. node-postgres and PGlite
 * parse int8/numeric differently, so every query routed through here must cast
 * large integers to text and counts to int explicitly; callers convert with BigInt().
 */
export async function queryRows<T>(db: Database, query: SQL): Promise<T[]> {
  const result: unknown = await db.execute(query);
  return (result as { rows: T[] }).rows;
}
