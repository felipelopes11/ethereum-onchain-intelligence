import {
  DataInconsistencyError,
  describeError,
  readTokenMetadata,
  RetryAbortedError,
  sleep as abortableSleep,
  type BlockchainProvider,
  type ChainBlock,
  type ChainReceipt,
} from '@eoi/blockchain';
import type { StartBlock } from '@eoi/config';
import type { IngestionRepository, TokenRepository } from '@eoi/database';
import { buildBundle } from './bundle-builder';
import { mapWithConcurrency } from './concurrency';
import type { IndexerMetrics } from './metrics';

export interface Logger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface IndexerOptions {
  chainId: number;
  confirmations: number;
  startBlock: StartBlock;
  batchSize: number;
  fetchConcurrency: number;
  pollIntervalMs: number;
  maxReorgDepth: number;
  metadataBatchSize: number;
}

export interface IndexerDeps {
  provider: BlockchainProvider;
  ingestion: IngestionRepository;
  tokens: TokenRepository;
  metrics: IndexerMetrics;
  logger: Logger;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

export type BatchOutcome =
  | { kind: 'processed'; from: bigint; to: bigint }
  | { kind: 'at-head'; safeHead: bigint }
  | { kind: 'reorg'; commonAncestor: bigint; removedBlocks: number };

/** A reorg deeper than configured: refusing to auto-repair is the safe default. */
export class ReorgTooDeepError extends Error {
  constructor(depth: number) {
    super(`Reorg deeper than ${depth} blocks; manual intervention required`);
    this.name = 'ReorgTooDeepError';
  }
}

interface FetchedBlock {
  block: ChainBlock;
  receipts: ChainReceipt[];
}

/**
 * Sequential, checkpointed block indexer.
 *
 * Correctness model:
 *  - Only blocks at least `confirmations` deep are indexed (safe head).
 *  - Each batch is persisted atomically together with the checkpoint.
 *  - Before persisting, the batch's first parentHash must equal the checkpoint hash;
 *    a mismatch means the chain reorganised below the safe head, and we walk back to
 *    the common ancestor and roll back (see ADR-005).
 */
export class Indexer {
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly now: () => number;

  constructor(
    private readonly options: IndexerOptions,
    private readonly deps: IndexerDeps,
  ) {
    this.sleep = deps.sleep ?? abortableSleep;
    this.now = deps.now ?? Date.now;
  }

  async run(signal: AbortSignal): Promise<void> {
    const { logger, metrics } = this.deps;
    logger.info(
      { options: { ...this.options, startBlock: describeStartBlock(this.options.startBlock) } },
      'indexer starting',
    );
    while (!signal.aborted) {
      try {
        const outcome = await this.runOnce();
        if (outcome.kind === 'at-head') await this.sleep(this.options.pollIntervalMs, signal);
      } catch (error) {
        if (error instanceof RetryAbortedError || isAborted(signal)) break;
        if (error instanceof ReorgTooDeepError) throw error;
        const consecutive = metrics.recordError();
        const backoffMs = Math.min(
          60_000,
          this.options.pollIntervalMs * 2 ** Math.min(consecutive, 6),
        );
        logger.error(
          { err: describeError(error), consecutive, backoffMs },
          'indexer iteration failed',
        );
        try {
          await this.sleep(backoffMs, signal);
        } catch {
          break;
        }
      }
    }
    logger.info({ metrics: metrics.snapshot() }, 'indexer stopped');
  }

  async runOnce(): Promise<BatchOutcome> {
    const { provider, ingestion, metrics, logger } = this.deps;
    const checkpoint = await ingestion.getCheckpoint();
    const chainHead = await provider.getLatestBlockNumber();
    const safeHead = chainHead - BigInt(this.options.confirmations);
    metrics.recordHead(chainHead, safeHead);

    const next = checkpoint ? checkpoint.blockNumber + 1n : this.resolveStartBlock(safeHead);
    if (next > safeHead) {
      metrics.recordIdle(checkpoint?.blockNumber ?? null);
      return { kind: 'at-head', safeHead };
    }

    const end = minBigInt(next + BigInt(this.options.batchSize) - 1n, safeHead);
    const started = this.now();
    const fetched = await this.fetchRange(next, end);

    const first = fetched[0];
    if (checkpoint && first && first.block.parentHash !== checkpoint.blockHash) {
      return this.recoverFromReorg(checkpoint.blockNumber);
    }
    assertContiguous(fetched);

    const built = fetched.map(({ block, receipts }) =>
      buildBundle(this.options.chainId, block, receipts),
    );
    await ingestion.persistBlocks(built.map((b) => b.bundle));

    const latencyMs = this.now() - started;
    const totals = built.reduce(
      (acc, { stats }) => ({
        transactions: acc.transactions + stats.transactions,
        logs: acc.logs + stats.logs,
        transfers: acc.transfers + stats.transfers,
        malformed: acc.malformed + stats.malformedTransferLogs,
      }),
      { transactions: 0, logs: 0, transfers: 0, malformed: 0 },
    );
    metrics.recordBatch(end, fetched.length, latencyMs, totals.malformed);
    logger.info(
      {
        fromBlock: next.toString(),
        toBlock: end.toString(),
        targetBlock: safeHead.toString(),
        chainHead: chainHead.toString(),
        lag: (safeHead - end).toString(),
        latencyMs,
        blocksPerSecond: metrics.snapshot().blocksPerSecond,
        ...totals,
        rpc: provider.stats(),
      },
      'batch indexed',
    );

    await this.refreshTokenMetadata();
    return { kind: 'processed', from: next, to: end };
  }

  private resolveStartBlock(safeHead: bigint): bigint {
    const start = this.options.startBlock;
    switch (start.kind) {
      case 'latest':
        return safeHead;
      case 'offset':
        return maxBigInt(0n, safeHead - start.blocks);
      case 'absolute':
        return start.block;
    }
  }

  private async fetchRange(from: bigint, to: bigint): Promise<FetchedBlock[]> {
    const numbers: bigint[] = [];
    for (let n = from; n <= to; n++) numbers.push(n);
    return mapWithConcurrency(numbers, this.options.fetchConcurrency, async (blockNumber) => {
      const block = await this.deps.provider.getBlockWithTransactions(blockNumber);
      const receipts = await this.deps.provider.getBlockReceipts(block);
      return { block, receipts };
    });
  }

  /**
   * Walks back from the checkpoint comparing stored hashes with the canonical chain
   * until they agree, then rolls back everything above the common ancestor.
   */
  private async recoverFromReorg(checkpointBlock: bigint): Promise<BatchOutcome> {
    const { provider, ingestion, metrics, logger } = this.deps;
    for (let depth = 0; depth <= this.options.maxReorgDepth; depth++) {
      const candidate = checkpointBlock - BigInt(depth);
      const stored = await ingestion.getStoredBlockHash(candidate);
      const canonical = candidate >= 0n ? await provider.getBlockHeader(candidate) : null;
      if (stored === null || stored === canonical?.hash) {
        // stored === null: we walked below the first indexed block; rollback resets the checkpoint.
        const { removedBlocks } = await ingestion.rollbackTo(candidate);
        metrics.recordReorg(removedBlocks);
        logger.warn(
          {
            commonAncestor: candidate.toString(),
            depth,
            removedBlocks,
            previousCheckpoint: checkpointBlock.toString(),
          },
          'chain reorganisation detected; rolled back to common ancestor',
        );
        return { kind: 'reorg', commonAncestor: candidate, removedBlocks };
      }
    }
    throw new ReorgTooDeepError(this.options.maxReorgDepth);
  }

  private async refreshTokenMetadata(): Promise<void> {
    const { provider, tokens, logger } = this.deps;
    const pending = await tokens.findPendingMetadata(this.options.metadataBatchSize);
    await mapWithConcurrency(pending, this.options.fetchConcurrency, async (token) => {
      const metadata = await readTokenMetadata(provider, token.address, token.standard);
      await tokens.updateMetadata(token.address, {
        name: metadata.name,
        symbol: metadata.symbol,
        decimals: metadata.decimals,
        totalSupply: metadata.totalSupply,
        status: metadata.status,
        error: metadata.errors.length > 0 ? metadata.errors.join('; ') : null,
        declaredInterfaces: metadata.declaredInterfaces,
      });
      logger.debug({ token: token.address, status: metadata.status }, 'token metadata fetched');
    });
  }
}

function assertContiguous(fetched: readonly FetchedBlock[]): void {
  for (let i = 1; i < fetched.length; i++) {
    const previous = fetched[i - 1];
    const current = fetched[i];
    if (previous && current && current.block.parentHash !== previous.block.hash) {
      // The chain moved while we were fetching; the next iteration refetches.
      throw new DataInconsistencyError(
        `Block ${current.block.number} does not extend ${previous.block.number} within one batch`,
      );
    }
  }
}

/** Read through a function: the signal flips asynchronously, which flow analysis cannot see. */
const isAborted = (signal: AbortSignal): boolean => signal.aborted;

function describeStartBlock(start: StartBlock): string {
  switch (start.kind) {
    case 'latest':
      return 'latest';
    case 'offset':
      return `safe head - ${start.blocks}`;
    case 'absolute':
      return start.block.toString();
  }
}

const minBigInt = (a: bigint, b: bigint) => (a < b ? a : b);
const maxBigInt = (a: bigint, b: bigint) => (a > b ? a : b);
