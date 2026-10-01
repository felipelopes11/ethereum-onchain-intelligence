import { pino } from 'pino';
import { EvmProvider, ProtocolRegistry, viemChainFor } from '@eoi/blockchain';
import { indexerEnvSchema, parseEnv, redactUrl } from '@eoi/config';
import {
  createDatabase,
  IngestionRepository,
  ProtocolRepository,
  TokenRepository,
} from '@eoi/database';
import { getChainInfo } from '@eoi/shared';
import { startHealthServer } from './health-server';
import { Indexer, ReorgTooDeepError } from './indexer';
import { IndexerMetrics } from './metrics';

const env = parseEnv(indexerEnvSchema);
const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'indexer', chainId: env.ETHEREUM_CHAIN_ID },
  redact: ['*.rpcUrl', '*.databaseUrl', '*.password'],
});

const chain = getChainInfo(env.ETHEREUM_CHAIN_ID);
if (!chain) {
  logger.fatal({ chainId: env.ETHEREUM_CHAIN_ID }, 'unsupported chain id');
  process.exit(1);
}

const provider = new EvmProvider({
  rpcUrl: env.ETHEREUM_RPC_URL,
  chainId: chain.id,
  chain: viemChainFor(chain.id),
  timeoutMs: env.RPC_TIMEOUT_MS,
  maxRetries: env.RPC_MAX_RETRIES,
  maxRequestsPerSecond: env.RPC_MAX_REQUESTS_PER_SECOND,
  onRetry: (info) => logger.warn(info, 'rpc retry'),
});

const remoteChainId = await provider.getChainId();
if (remoteChainId !== chain.id) {
  // Indexing the wrong network into this database would silently corrupt it.
  logger.fatal(
    { expected: chain.id, actual: remoteChainId },
    'RPC endpoint serves a different chain',
  );
  process.exit(1);
}

const database = createDatabase(env.DATABASE_URL, {
  onConnectionError: (err) =>
    logger.warn({ err: err.message }, 'database connection error; pool will reconnect'),
  applicationName: 'eoi-indexer',
  statementTimeoutMs: 60_000,
});
const ingestion = new IngestionRepository(database.db, chain.id);
await ingestion.ensureChain(chain);

const registry = new ProtocolRegistry(chain.id);
await new ProtocolRepository(database.db, chain.id).sync(
  registry.adapters.map((adapter) => ({
    id: adapter.id,
    name: adapter.name,
    category: adapter.category,
    website: adapter.website,
    contracts: (adapter.deployments[chain.id] ?? []).map(({ address, role }) => ({
      address,
      role,
    })),
  })),
);

const metrics = new IndexerMetrics(() => provider.stats());
const healthServer = await startHealthServer(metrics, {
  port: env.INDEXER_HEALTH_PORT,
  staleAfterMs: Math.max(120_000, env.INDEXER_POLL_INTERVAL_MS * 10),
});

const indexer = new Indexer(
  {
    chainId: chain.id,
    confirmations: env.CONFIRMATIONS,
    startBlock: env.INDEXER_START_BLOCK,
    batchSize: env.INDEXER_BATCH_SIZE,
    fetchConcurrency: env.INDEXER_FETCH_CONCURRENCY,
    pollIntervalMs: env.INDEXER_POLL_INTERVAL_MS,
    maxReorgDepth: env.INDEXER_MAX_REORG_DEPTH,
    metadataBatchSize: env.INDEXER_METADATA_BATCH_SIZE,
  },
  {
    provider,
    ingestion,
    tokens: new TokenRepository(database.db, chain.id),
    metrics,
    logger,
  },
);

logger.info(
  {
    rpc: redactUrl(env.ETHEREUM_RPC_URL),
    database: redactUrl(env.DATABASE_URL),
    healthPort: env.INDEXER_HEALTH_PORT,
  },
  'connected',
);

const metricsTimer = setInterval(() => {
  logger.info({ metrics: metrics.snapshot() }, 'indexer metrics');
}, env.INDEXER_METRICS_INTERVAL_MS);

// Graceful shutdown: stop scheduling work, let the in-flight batch transaction finish
// (it either commits with its checkpoint or rolls back entirely), then close resources.
const controller = new AbortController();
const shutdown = (signal: string) => {
  if (controller.signal.aborted) return;
  logger.info({ signal }, 'shutdown requested');
  controller.abort();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

let exitCode = 0;
try {
  await indexer.run(controller.signal);
} catch (error) {
  exitCode = 1;
  const reason = error instanceof ReorgTooDeepError ? 'reorg-too-deep' : 'fatal';
  logger.fatal({ err: error, reason }, 'indexer crashed');
} finally {
  clearInterval(metricsTimer);
  healthServer.close();
  await database.close();
}
process.exit(exitCode);
