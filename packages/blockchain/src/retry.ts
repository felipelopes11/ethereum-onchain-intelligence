export interface RetryOptions {
  /** Number of retries after the first attempt. */
  retries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isRetryable: (error: unknown) => boolean;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  signal?: AbortSignal;
  /** Injectable for deterministic tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

export class RetryAbortedError extends Error {
  constructor() {
    super('Retry aborted');
    this.name = 'RetryAbortedError';
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RetryAbortedError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new RetryAbortedError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Exponential backoff with "full jitter" (delay = random(0, min(cap, base * 2^n))).
 * Full jitter spreads retries from many workers so they do not hammer a rate-limited
 * RPC endpoint in lockstep.
 */
export function backoffDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number,
): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 15_000;
  const wait = options.sleep ?? sleep;
  const random = options.random ?? Math.random;

  for (let attempt = 0; ; attempt++) {
    if (options.signal?.aborted) throw new RetryAbortedError();
    try {
      return await operation();
    } catch (error) {
      if (attempt >= options.retries || !options.isRetryable(error)) throw error;
      const delayMs = backoffDelay(attempt, baseDelayMs, maxDelayMs, random);
      options.onRetry?.({ attempt: attempt + 1, delayMs, error });
      await wait(delayMs, options.signal);
    }
  }
}
