import { pino } from 'pino';
import {
  AbiRegistry,
  EvmProvider,
  MainnetEnsResolver,
  ProtocolRegistry,
  viemChainFor,
} from '@eoi/blockchain';
import { apiEnvSchema, parseEnv, redactUrl } from '@eoi/config';
import { createDatabase } from '@eoi/database';
import { getChainInfo } from '@eoi/shared';
import { buildApp } from './app';
import { createCaches, type ApiContext } from './context';

const env = parseEnv(apiEnvSchema);
const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'api', chainId: env.ETHEREUM_CHAIN_ID },
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});

const chain = getChainInfo(env.ETHEREUM_CHAIN_ID);
if (!chain) {
  logger.fatal({ chainId: env.ETHEREUM_CHAIN_ID }, 'unsupported chain id');
  process.exit(1);
}

const database = createDatabase(env.DATABASE_URL, {
  onConnectionError: (err) =>
    logger.warn({ err: err.message }, 'database connection error; pool will reconnect'),
  applicationName: 'eoi-api',
  maxConnections: 10,
});
const protocols = new ProtocolRegistry(chain.id);

const ctx: ApiContext = {
  chain,
  db: database.db,
  pingDatabase: () => database.ping(),
  provider: new EvmProvider({
    rpcUrl: env.ETHEREUM_RPC_URL,
    chainId: chain.id,
    chain: viemChainFor(chain.id),
    timeoutMs: env.RPC_TIMEOUT_MS,
    // User-facing requests should fail fast rather than retry for a long time.
    maxRetries: Math.min(env.RPC_MAX_RETRIES, 2),
    maxRequestsPerSecond: env.RPC_MAX_REQUESTS_PER_SECOND,
  }),
  ens: env.ENS_RPC_URL ? new MainnetEnsResolver(env.ENS_RPC_URL) : null,
  protocols,
  abis: new AbiRegistry(protocols.abiSources()),
  caches: createCaches(env.CACHE_TTL_MS),
  logger,
  now: () => new Date(),
};

const app = await buildApp(ctx, {
  corsOrigins: env.CORS_ORIGIN,
  rateLimit: { max: env.RATE_LIMIT_MAX, windowMs: env.RATE_LIMIT_WINDOW_MS },
  trustProxy: env.TRUST_PROXY,
  logger,
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'shutting down');
  await app.close();
  await database.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: env.API_HOST, port: env.API_PORT });
logger.info(
  {
    rpc: redactUrl(env.ETHEREUM_RPC_URL),
    database: redactUrl(env.DATABASE_URL),
    ens: Boolean(ctx.ens),
  },
  'api listening',
);
