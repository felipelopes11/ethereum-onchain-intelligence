import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const urlWithProtocols = (protocols: readonly string[]) =>
  z
    .string()
    .trim()
    .min(1)
    .refine(
      (value) => {
        try {
          return protocols.includes(new URL(value).protocol);
        } catch {
          return false;
        }
      },
      `Expected a URL using one of: ${protocols.join(', ')}`,
    );

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const nonNegativeInt = (fallback: number) =>
  z.coerce.number().int().nonnegative().default(fallback);

/**
 * INDEXER_START_BLOCK only matters when no checkpoint exists:
 *   "1234567" -> start at that block
 *   "-1000"   -> start 1000 blocks behind the safe head
 *   "latest"  -> start at the safe head (useful for demos)
 */
export const startBlockSchema = z
  .string()
  .trim()
  .regex(/^(latest|-?\d{1,12})$/, 'Expected a block number, a negative offset, or "latest"')
  .transform((value): StartBlock => {
    if (value === 'latest') return { kind: 'latest' };
    const n = BigInt(value);
    return n < 0n ? { kind: 'offset', blocks: -n } : { kind: 'absolute', block: n };
  });
export type StartBlock =
  { kind: 'latest' } | { kind: 'offset'; blocks: bigint } | { kind: 'absolute'; block: bigint };

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DATABASE_URL: urlWithProtocols(['postgres:', 'postgresql:']),
  ETHEREUM_RPC_URL: urlWithProtocols(['http:', 'https:']),
  ETHEREUM_CHAIN_ID: z.coerce.number().int().positive().default(11155111),
  RPC_TIMEOUT_MS: positiveInt(15_000),
  RPC_MAX_RETRIES: nonNegativeInt(5),
  RPC_MAX_REQUESTS_PER_SECOND: positiveInt(10),
});

export const indexerEnvSchema = baseSchema.extend({
  CONFIRMATIONS: nonNegativeInt(12),
  INDEXER_START_BLOCK: startBlockSchema.prefault('-500'),
  INDEXER_BATCH_SIZE: positiveInt(10).pipe(z.number().max(500)),
  INDEXER_FETCH_CONCURRENCY: positiveInt(4).pipe(z.number().max(32)),
  INDEXER_POLL_INTERVAL_MS: positiveInt(6_000),
  INDEXER_MAX_REORG_DEPTH: positiveInt(64),
  INDEXER_METRICS_INTERVAL_MS: positiveInt(30_000),
  INDEXER_METADATA_BATCH_SIZE: positiveInt(20).pipe(z.number().max(200)),
  INDEXER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(4100),
});
export type IndexerEnv = z.infer<typeof indexerEnvSchema>;

export const apiEnvSchema = baseSchema.extend({
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  CORS_ORIGIN: z
    .string()
    .prefault('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  RATE_LIMIT_MAX: positiveInt(120),
  RATE_LIMIT_WINDOW_MS: positiveInt(60_000),
  CACHE_TTL_MS: positiveInt(15_000),
  /** Optional mainnet RPC used only for ENS resolution. ENS is disabled when unset. */
  ENS_RPC_URL: urlWithProtocols(['http:', 'https:']).optional(),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .prefault('false')
    .transform((value) => value === 'true'),
});
export type ApiEnv = z.infer<typeof apiEnvSchema>;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

/** Empty strings are treated as unset so that `.env.example` copies work out of the box. */
function withoutEmptyValues(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value.trim() !== '') out[key] = value;
  }
  return out;
}

export function parseEnv<S extends z.ZodType>(
  schema: S,
  env: Record<string, string | undefined> = process.env,
): z.infer<S> {
  const result = schema.safeParse(withoutEmptyValues(env));
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}

/** Strips credentials from a URL before it is logged. */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.username) url.username = '***';
    if (url.password) url.password = '***';
    // Many RPC providers embed the API key in the path or query string.
    if (url.search) url.search = '?***';
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.some((segment) => segment.length >= 20)) url.pathname = '/***';
    return url.toString();
  } catch {
    return '***';
  }
}
