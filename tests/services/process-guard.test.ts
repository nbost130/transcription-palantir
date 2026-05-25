/**
 * Tests for ProcessGuardService — Redis singleton lock.
 *
 * Validates the contract the disabled-for-six-months guard never enforced:
 *   - Only one acquirer succeeds; others fail
 *   - Releasing lets a new acquirer in
 *   - A stale lock (expired TTL) is reacquirable
 */

import { Redis as IORedis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProcessGuardService } from '../../src/services/process-guard.js';
import { getRedisUrl } from '../../src/config/index.js';

const skipIfNoRedis = process.env.SKIP_REDIS_TESTS === '1';
const LOCK_KEY = 'palantir:singleton-lock';

describe.skipIf(skipIfNoRedis)('ProcessGuardService - Redis singleton lock', () => {
  let helper: ReturnType<typeof IORedis.prototype.constructor> extends never ? never : InstanceType<typeof IORedis>;

  beforeAll(() => {
    helper = new IORedis(getRedisUrl(), { maxRetriesPerRequest: null });
  });

  afterAll(async () => {
    await helper.del(LOCK_KEY);
    await helper.quit();
  });

  beforeEach(async () => {
    await helper.del(LOCK_KEY);
  });

  it('first acquire succeeds; second concurrent acquire fails', async () => {
    const guard1 = new ProcessGuardService();
    const guard2 = new ProcessGuardService();

    const a1 = await guard1.acquire();
    const a2 = await guard2.acquire();

    expect(a1).toBe(true);
    expect(a2).toBe(false);

    await guard1.release();
    await guard2.release();
  });

  it('release allows a fresh instance to acquire', async () => {
    const guard1 = new ProcessGuardService();
    expect(await guard1.acquire()).toBe(true);
    await guard1.release();

    const guard2 = new ProcessGuardService();
    expect(await guard2.acquire()).toBe(true);
    await guard2.release();
  });

  it('stale lock (TTL expired) is reacquirable without manual cleanup', async () => {
    // Plant a stale lock with a 1ms TTL — by the time acquire() runs, it has expired.
    await helper.set(LOCK_KEY, 'stale-token', 'PX', 1);
    await new Promise((r) => setTimeout(r, 50));

    const guard = new ProcessGuardService();
    expect(await guard.acquire()).toBe(true);
    await guard.release();
  });

  it('release is idempotent and safe to call when not acquired', async () => {
    const guard = new ProcessGuardService();
    await expect(guard.release()).resolves.not.toThrow();
  });
});
