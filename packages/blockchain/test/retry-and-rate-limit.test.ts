import {
  HttpRequestError,
  InvalidParamsRpcError,
  LimitExceededRpcError,
  RpcRequestError,
} from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { isRetryableRpcError } from '../src/errors';
import { DataInconsistencyError } from '../src/provider';
import { TokenBucketRateLimiter, type Clock } from '../src/rate-limiter';
import { backoffDelay, RetryAbortedError, withRetry } from '../src/retry';

const noSleep = () => Promise.resolve();

describe('withRetry', () => {
  it('retries transient failures and returns the eventual result', async () => {
    const op = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('ok');
    const onRetry = vi.fn();
    await expect(
      withRetry(op, { retries: 3, isRetryable: () => true, sleep: noSleep, onRetry }),
    ).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls.map(([info]) => (info as { attempt: number }).attempt)).toEqual([
      1, 2,
    ]);
  });

  it('does not retry non-retryable errors', async () => {
    const op = vi.fn<() => Promise<never>>().mockRejectedValue(new Error('invalid params'));
    await expect(
      withRetry(op, { retries: 5, isRetryable: () => false, sleep: noSleep }),
    ).rejects.toThrow('invalid params');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('gives up after the configured number of retries', async () => {
    const op = vi.fn<() => Promise<never>>().mockRejectedValue(new Error('down'));
    await expect(
      withRetry(op, { retries: 2, isRetryable: () => true, sleep: noSleep }),
    ).rejects.toThrow('down');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('stops immediately when aborted (graceful shutdown)', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      withRetry(() => Promise.resolve(1), {
        retries: 1,
        isRetryable: () => true,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(RetryAbortedError);
  });

  it('uses capped exponential backoff with full jitter', () => {
    expect([0, 1, 2, 3].map((n) => backoffDelay(n, 100, 1_000, () => 0.999))).toEqual([
      99, 199, 399, 799,
    ]);
    expect(backoffDelay(10, 100, 1_000, () => 0.999)).toBe(999);
    expect(backoffDelay(3, 100, 1_000, () => 0)).toBe(0);
  });
});

describe('isRetryableRpcError', () => {
  const http = (status: number) => new HttpRequestError({ url: 'https://rpc.test', status });

  it.each([
    ['HTTP 429', http(429), true],
    ['HTTP 503', http(503), true],
    ['HTTP 401', http(401), false],
    ['limit exceeded', new LimitExceededRpcError(new Error('x')), true],
    ['invalid params', new InvalidParamsRpcError(new Error('x')), false],
    [
      'header not found',
      new RpcRequestError({
        body: {},
        url: 'u',
        error: { code: -32000, message: 'header not found' },
      }),
      true,
    ],
    [
      'execution reverted',
      new RpcRequestError({
        body: {},
        url: 'u',
        error: { code: 3, message: 'execution reverted' },
      }),
      false,
    ],
    ['inconsistent node data', new DataInconsistencyError('receipt mismatch'), true],
    ['network failure', new TypeError('fetch failed'), true],
  ])('%s -> %s', (_label, error, expected) => {
    expect(isRetryableRpcError(error)).toBe(expected);
  });
});

describe('TokenBucketRateLimiter', () => {
  function fakeClock(): Clock & { advance(ms: number): void; slept: number[] } {
    let now = 0;
    const slept: number[] = [];
    return {
      now: () => now,
      sleep: (ms) => {
        slept.push(ms);
        now += ms;
        return Promise.resolve();
      },
      advance: (ms) => {
        now += ms;
      },
      slept,
    };
  }

  it('allows a burst, then spaces requests at the configured rate', async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter(2, 2, clock);
    await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire(), limiter.acquire()]);
    expect(clock.slept).toEqual([500, 500]);
  });

  it('refills over time', async () => {
    const clock = fakeClock();
    const limiter = new TokenBucketRateLimiter(1, 1, clock);
    await limiter.acquire();
    clock.advance(1_000);
    await limiter.acquire();
    expect(clock.slept).toEqual([]);
  });
});
