import type { ProviderStats } from '@eoi/blockchain';

export interface MetricsSnapshot {
  chainHead: string | null;
  targetBlock: string | null;
  currentBlock: string | null;
  lag: string | null;
  blocksProcessed: number;
  blocksPerSecond: number;
  lastBatchLatencyMs: number | null;
  lastBatchSize: number;
  reorgs: number;
  blocksRolledBack: number;
  malformedTransferLogs: number;
  consecutiveErrors: number;
  lastSuccessAt: string | null;
  rpc: ProviderStats;
}

/** In-process counters for structured logs and the health endpoint. */
export class IndexerMetrics {
  private chainHead: bigint | null = null;
  private targetBlock: bigint | null = null;
  private currentBlock: bigint | null = null;
  private blocksProcessed = 0;
  private lastBatchLatencyMs: number | null = null;
  private lastBatchSize = 0;
  private reorgs = 0;
  private blocksRolledBack = 0;
  private malformedTransferLogs = 0;
  private consecutiveErrors = 0;
  private lastSuccessAt: number | null = null;
  /** Exponential moving average so a single slow batch does not dominate. */
  private blocksPerSecondEma = 0;

  constructor(
    private readonly rpcStats: () => ProviderStats,
    private readonly now: () => number = Date.now,
  ) {}

  recordHead(chainHead: bigint, targetBlock: bigint): void {
    this.chainHead = chainHead;
    this.targetBlock = targetBlock;
  }

  recordBatch(lastBlock: bigint, size: number, latencyMs: number, malformedLogs: number): void {
    this.currentBlock = lastBlock;
    this.blocksProcessed += size;
    this.lastBatchSize = size;
    this.lastBatchLatencyMs = latencyMs;
    this.malformedTransferLogs += malformedLogs;
    const rate = latencyMs > 0 ? (size * 1000) / latencyMs : size;
    this.blocksPerSecondEma =
      this.blocksPerSecondEma === 0 ? rate : 0.3 * rate + 0.7 * this.blocksPerSecondEma;
    this.recordSuccess();
  }

  recordIdle(currentBlock: bigint | null): void {
    if (currentBlock !== null) this.currentBlock = currentBlock;
    this.recordSuccess();
  }

  recordReorg(rolledBack: number): void {
    this.reorgs++;
    this.blocksRolledBack += rolledBack;
  }

  recordError(): number {
    return ++this.consecutiveErrors;
  }

  msSinceLastSuccess(): number | null {
    return this.lastSuccessAt === null ? null : this.now() - this.lastSuccessAt;
  }

  snapshot(): MetricsSnapshot {
    const lag =
      this.targetBlock !== null && this.currentBlock !== null
        ? (this.targetBlock > this.currentBlock
            ? this.targetBlock - this.currentBlock
            : 0n
          ).toString()
        : null;
    return {
      chainHead: this.chainHead?.toString() ?? null,
      targetBlock: this.targetBlock?.toString() ?? null,
      currentBlock: this.currentBlock?.toString() ?? null,
      lag,
      blocksProcessed: this.blocksProcessed,
      blocksPerSecond: Math.round(this.blocksPerSecondEma * 100) / 100,
      lastBatchLatencyMs: this.lastBatchLatencyMs,
      lastBatchSize: this.lastBatchSize,
      reorgs: this.reorgs,
      blocksRolledBack: this.blocksRolledBack,
      malformedTransferLogs: this.malformedTransferLogs,
      consecutiveErrors: this.consecutiveErrors,
      lastSuccessAt:
        this.lastSuccessAt === null ? null : new Date(this.lastSuccessAt).toISOString(),
      rpc: this.rpcStats(),
    };
  }

  private recordSuccess(): void {
    this.consecutiveErrors = 0;
    this.lastSuccessAt = this.now();
  }
}
