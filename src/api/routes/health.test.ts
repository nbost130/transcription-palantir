/**
 * 🔮 Transcription Palantir - Health Route Tests
 *
 * `/api/v1/ready` is the seam that turns red when requests are actually
 * failing (see ISA.md WP2). These tests exercise the real handler via
 * Fastify `inject`, with every external dependency mocked except
 * `request-stats`, which is exercised for real via `recordResponse`/`reset`.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordResponse, reset as resetRequestStats } from '../../services/request-stats.js';

// -----------------------------------------------------------------------------
// Mocks
// -----------------------------------------------------------------------------

const mockRedisConnection = {
  status: 'ready' as string,
  ping: vi.fn(async () => 'PONG'),
};

const mockTranscriptionQueue = {
  isReady: true,
  getJobCounts: vi.fn(async () => ({
    waiting: 1,
    active: 2,
    completed: 3,
    failed: 0,
    delayed: 0,
    paused: 0,
    prioritized: 0,
    total: 6,
  })),
};

vi.mock('../../services/queue.js', () => ({
  transcriptionQueue: mockTranscriptionQueue,
  redisConnection: mockRedisConnection,
}));

const mockFileWatcher = {
  running: true,
  processedCount: 0,
};

vi.mock('../../services/file-watcher.js', () => ({
  fileWatcher: mockFileWatcher,
}));

const mockFasterWhisperService = {
  checkBinaryAvailability: vi.fn(async () => ({ available: true, path: '/usr/bin/python3' })),
  getHealthStatus: vi.fn(async () => ({ whisperBinaryStatus: 'available', whisperVersion: '1.1.1' })),
};

vi.mock('../../services/faster-whisper.js', () => ({
  fasterWhisperService: mockFasterWhisperService,
}));

const mockTranscriptionWorker = {
  running: true,
};

vi.mock('../../workers/transcription-worker.js', () => ({
  transcriptionWorker: mockTranscriptionWorker,
}));

vi.mock('../../services/metrics.js', () => ({
  metrics: { snapshot: vi.fn(() => ({})) },
}));

vi.mock('../../config/index.js', () => ({
  appConfig: {
    env: 'test',
    processing: { watchDirectory: '/tmp/watch-does-not-need-to-exist' },
  },
}));

// checkDirectoryAccess uses node:fs/promises `access`; point it somewhere that
// always resolves so the soft file_watcher check reports `up` without caring
// about a real directory on disk.
vi.mock('node:fs/promises', () => ({
  access: vi.fn(async () => undefined),
  constants: { R_OK: 4, W_OK: 2, X_OK: 1 },
}));

// -----------------------------------------------------------------------------
// Test harness
// -----------------------------------------------------------------------------

async function buildApp(): Promise<FastifyInstance> {
  const { healthRoutes } = await import('./health.js');
  const app = Fastify();
  await app.register(healthRoutes, { prefix: '/api/v1' });
  await app.ready();
  return app;
}

describe('GET /api/v1/ready', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    resetRequestStats();
    mockRedisConnection.status = 'ready';
    mockRedisConnection.ping.mockReset().mockResolvedValue('PONG');
    mockTranscriptionQueue.getJobCounts.mockReset().mockResolvedValue({
      waiting: 1,
      active: 2,
      completed: 3,
      failed: 0,
      delayed: 0,
      paused: 0,
      prioritized: 0,
      total: 6,
    });
    mockFasterWhisperService.checkBinaryAvailability
      .mockReset()
      .mockResolvedValue({ available: true, path: '/usr/bin/python3' });
    mockTranscriptionWorker.running = true;
    mockFileWatcher.running = true;
    const { READY_TIMEOUTS } = await import('./health.js');
    READY_TIMEOUTS.redisPingMs = 1_000;
    READY_TIMEOUTS.queueMs = 2_000;
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('a. reports 200 ready when every check is healthy', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ready');
    expect(body.checks.redis.status).toBe('up');
    expect(body.checks.queue.status).toBe('up');
    expect(body.checks.queue.counts).toMatchObject({ total: 6 });
  });

  it('b. reports 503 with checks.redis down when redisConnection.status is not ready (ISC-9)', async () => {
    mockRedisConnection.status = 'reconnecting';
    const res = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.status).toBe('not ready');
    expect(body.checks.redis.status).toBe('down');
    expect(body.checks.redis.error).toContain('reconnecting');
  });

  it('c. reports 503 with checks.queue.error containing the thrown message when getJobCounts rejects (ISC-10)', async () => {
    mockTranscriptionQueue.getJobCounts.mockReset().mockRejectedValue(new Error('LOADING Redis is loading'));
    const res = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.checks.queue.status).toBe('down');
    expect(body.checks.queue.error).toContain('LOADING');
  });

  it('d. reports 503 degraded when 7/12 responses are 5xx, and 200 when 2/12 are (ISC-12)', async () => {
    // No injected `now` here: the /ready handler calls snapshot() with the
    // real clock, so samples must be recorded against real time too.
    for (let i = 0; i < 5; i++) recordResponse(200);
    for (let i = 0; i < 7; i++) recordResponse(500);

    const res = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.checks.requests.status).toBe('degraded');
    expect(body.checks.requests.serverErrorRate).toBeCloseTo(7 / 12, 5);

    resetRequestStats();
    for (let i = 0; i < 10; i++) recordResponse(200);
    for (let i = 0; i < 2; i++) recordResponse(500);

    const res2 = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json();
    expect(body2.checks.requests.status).toBe('up');
    expect(body2.checks.requests.serverErrorRate).toBeCloseTo(2 / 12, 5);
  });

  it('e. stays 200 with whisper/worker reported down in non-production (ISC-13)', async () => {
    mockFasterWhisperService.checkBinaryAvailability
      .mockReset()
      .mockResolvedValue({ available: false, path: '/missing/python3' });
    mockTranscriptionWorker.running = false;

    const res = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ready');
    expect(body.checks.whisper.status).toBe('down');
    expect(body.checks.worker.status).toBe('down');
  });

  it('f. answers within ~2.5s with 503 when getJobCounts never resolves', async () => {
    const { READY_TIMEOUTS } = await import('./health.js');
    READY_TIMEOUTS.queueMs = 50;
    mockTranscriptionQueue.getJobCounts.mockReset().mockImplementation(() => new Promise(() => {}));

    const start = Date.now();
    const res = await app.inject({ method: 'GET', url: '/api/v1/ready' });
    const elapsed = Date.now() - start;

    expect(res.statusCode).toBe(503);
    expect(elapsed).toBeLessThan(2_500);
    const body = res.json();
    expect(body.checks.queue.status).toBe('down');
    expect(body.checks.queue.error).toContain('timed out');
  }, 3_000);
});
