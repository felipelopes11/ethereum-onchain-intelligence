/**
 * Postgres accepts at most 65,535 bind parameters per statement. Rows are chunked so
 * that a block with thousands of logs never produces a statement that exceeds it.
 */
const MAX_PARAMETERS = 60_000;

export function chunkForInsert<T extends object>(rows: readonly T[]): T[][] {
  const first = rows[0];
  if (!first) return [];
  const columns = Math.max(1, Object.keys(first).length);
  const size = Math.max(1, Math.floor(MAX_PARAMETERS / columns));
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
}
