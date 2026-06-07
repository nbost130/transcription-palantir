import { describe, expect, it, vi } from 'vitest';

// Mock the logger so this stays a pure unit test (no config/env import graph).
vi.mock('../utils/logger.js', () => ({
  queueLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { MAX_RECONNECT_DELAY_MS, redisRetryStrategy } from './redis-retry.js';

describe('redisRetryStrategy', () => {
  it('never gives up — always returns a positive number, even after many attempts', () => {
    // Regression guard: the old inline strategy returned `null` once the attempt
    // count passed REDIS_MAX_RETRIES (default 3), permanently killing the Redis
    // connection and causing every queue read to 500 until a manual restart.
    for (const times of [4, 10, 100, 10_000, 1_000_000]) {
      const delay = redisRetryStrategy(times);
      expect(typeof delay).toBe('number');
      expect(delay).toBeGreaterThan(0);
    }
  });

  it('uses linear backoff capped at MAX_RECONNECT_DELAY_MS', () => {
    expect(redisRetryStrategy(1)).toBe(50);
    expect(redisRetryStrategy(2)).toBe(100);
    expect(redisRetryStrategy(40)).toBe(MAX_RECONNECT_DELAY_MS);
    expect(redisRetryStrategy(99_999)).toBe(MAX_RECONNECT_DELAY_MS);
  });
});
