export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Token bucket limiting outgoing RPC requests per second. Free public RPC endpoints
 * throttle aggressively; staying under their limit is cheaper than retrying 429s.
 */
export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number = ratePerSecond,
    private readonly clock: Clock = systemClock,
  ) {
    if (ratePerSecond <= 0) throw new RangeError('ratePerSecond must be positive');
    this.tokens = burst;
    this.lastRefill = clock.now();
  }

  /** Resolves when a request may be sent. Calls are served in FIFO order. */
  acquire(): Promise<void> {
    const next = this.queue.then(() => this.take());
    this.queue = next;
    return next;
  }

  private refill(): void {
    const now = this.clock.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.burst, this.tokens + elapsedSeconds * this.ratePerSecond);
    this.lastRefill = now;
  }

  private async take(): Promise<void> {
    this.refill();
    while (this.tokens < 1) {
      const waitMs = Math.ceil(((1 - this.tokens) / this.ratePerSecond) * 1000);
      await this.clock.sleep(waitMs);
      this.refill();
    }
    this.tokens -= 1;
  }
}
