import type {
  AbiRegistry,
  BlockchainProvider,
  EnsResolver,
  ProtocolRegistry,
} from '@eoi/blockchain';
import type { Database } from '@eoi/database';
import type { ChainInfo, Hex } from '@eoi/shared';
import { TtlCache } from './cache';

export interface Logger {
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/** Everything a request handler needs, injected so tests can swap the RPC and database. */
export interface ApiContext {
  chain: ChainInfo;
  db: Database;
  pingDatabase(): Promise<void>;
  provider: BlockchainProvider;
  ens: EnsResolver | null;
  protocols: ProtocolRegistry;
  abis: AbiRegistry;
  caches: ApiCaches;
  logger: Logger;
  now(): Date;
}

export interface ApiCaches {
  balance: TtlCache<{ wei: bigint; blockNumber: bigint }>;
  nonce: TtlCache<number>;
  code: TtlCache<{ value: Hex | null; blockNumber: bigint }>;
  head: TtlCache<bigint>;
  ens: TtlCache<string | null>;
}

export function createCaches(liveTtlMs: number): ApiCaches {
  return {
    balance: new TtlCache(liveTtlMs),
    nonce: new TtlCache(liveTtlMs),
    // Bytecode presence rarely changes; the result is also persisted to the addresses table.
    code: new TtlCache(10 * 60_000),
    head: new TtlCache(2_000, 1),
    ens: new TtlCache(10 * 60_000),
  };
}
