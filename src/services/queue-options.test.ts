import { describe, expect, it, vi } from 'vitest';

// buildDefaultJobOptions is a pure function, but it lives in queue.ts alongside
// module-scope side effects (a real ioredis connection + BullMQ Queue/QueueEvents
// construction). Mock both so importing the module doesn't require a live Redis.
vi.mock('bullmq', () => ({
  Queue: vi.fn(function Queue() {
    return { getJob: vi.fn(), getJobCounts: vi.fn() };
  }),
  QueueEvents: vi.fn(function QueueEvents() {
    return { on: vi.fn(), waitUntilReady: vi.fn(), close: vi.fn() };
  }),
}));

vi.mock('ioredis', () => {
  class RedisMock {
    status = 'ready';
    on = vi.fn();
    quit = vi.fn(async () => {});
    duplicate = vi.fn(() => new RedisMock());
  }
  return { Redis: RedisMock, default: RedisMock };
});

const { buildDefaultJobOptions } = await import('./queue.js');

describe('buildDefaultJobOptions (ISC-15)', () => {
  it('carries removeOnComplete: 100 and removeOnFail: 50 from config', () => {
    const options = buildDefaultJobOptions({
      queue: { removeOnComplete: 100, removeOnFail: 50 },
      processing: { maxAttempts: 3 } as never,
    });

    expect(options.removeOnComplete).toBe(100);
    expect(options.removeOnFail).toBe(50);
  });

  it('maps a configured 0 to true (remove immediately) for removeOnComplete', () => {
    const options = buildDefaultJobOptions({
      queue: { removeOnComplete: 0, removeOnFail: 50 },
      processing: { maxAttempts: 3 } as never,
    });

    expect(options.removeOnComplete).toBe(true);
    expect(options.removeOnFail).toBe(50);
  });

  it('maps a configured 0 to true (remove immediately) for removeOnFail', () => {
    const options = buildDefaultJobOptions({
      queue: { removeOnComplete: 100, removeOnFail: 0 },
      processing: { maxAttempts: 3 } as never,
    });

    expect(options.removeOnComplete).toBe(100);
    expect(options.removeOnFail).toBe(true);
  });

  it('carries attempts from processing.maxAttempts and a fixed exponential backoff', () => {
    const options = buildDefaultJobOptions({
      queue: { removeOnComplete: 100, removeOnFail: 50 },
      processing: { maxAttempts: 7 } as never,
    });

    expect(options.attempts).toBe(7);
    expect(options.backoff).toEqual({ type: 'exponential', delay: 5000 });
    expect(options.delay).toBe(0);
  });
});
