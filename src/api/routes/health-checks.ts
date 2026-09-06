/**
 * 🔮 Transcription Palantir - Readiness Check Helpers
 *
 * The individual checks behind `GET /api/v1/ready`. Split out of health.ts
 * to keep that route file under the repo's 500-line cap; these are only
 * ever called from healthRoutes().
 */

import { access, constants } from 'node:fs/promises';
import { appConfig } from '../../config/index.js';
import { fasterWhisperService } from '../../services/faster-whisper.js';
import { fileWatcher } from '../../services/file-watcher.js';
import { redisConnection, transcriptionQueue } from '../../services/queue.js';
import { snapshot as requestStatsSnapshot } from '../../services/request-stats.js';
import { transcriptionWorker } from '../../workers/transcription-worker.js';

// =============================================================================
// READINESS CHECK TYPES & CONFIG
// =============================================================================

export type CheckStatus = 'up' | 'down' | 'degraded';

export interface CheckResult {
  status: CheckStatus;
  latencyMs?: number;
  error?: string;
  [key: string]: unknown;
}

/**
 * Timeouts for the readiness probe's real (non-boolean) checks.
 *
 * Exposed as a mutable object (rather than exported `const` primitives) so
 * tests can dial them down to exercise the "check never resolves" path
 * without waiting out the production timeout. Production code never mutates
 * this; only tests do.
 */
export const READY_TIMEOUTS = {
  redisPingMs: 1_000,
  queueMs: 2_000,
  /** fs.access on a network mount can block indefinitely; bound it. */
  fsMs: 500,
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export async function checkDirectoryAccess(dirPath: string): Promise<boolean> {
  return (await directoryAccess(dirPath)).ok;
}

/** Like checkDirectoryAccess, but says why (errno code) and never blocks past READY_TIMEOUTS.fsMs. */
export async function directoryAccess(dirPath: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    await withTimeout(access(dirPath, constants.R_OK | constants.W_OK), READY_TIMEOUTS.fsMs, `access ${dirPath}`);
    return { ok: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    return { ok: false, reason: code ?? errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Race a promise against a timeout, rejecting with a labeled error on expiry. */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// -----------------------------------------------------------------------------
// Individual readiness checks
// -----------------------------------------------------------------------------

/**
 * Redis is `up` only when the ioredis client reports status `'ready'` AND a
 * real ping succeeds within the timeout. This is ISC-9: the old readiness
 * probe never looked at Redis at all, so a reconnecting/dead connection was
 * invisible to anything outside the process.
 */
export async function checkRedis(): Promise<CheckResult> {
  const start = Date.now();
  let pingError: string | undefined;
  try {
    await withTimeout(redisConnection.ping(), READY_TIMEOUTS.redisPingMs, 'redis ping');
  } catch (error) {
    pingError = errorMessage(error);
  }
  const latencyMs = Date.now() - start;
  const status = redisConnection.status;

  if (status !== 'ready') {
    return { status: 'down', latencyMs, error: `redis status: ${status}` };
  }
  if (pingError) {
    return { status: 'down', latencyMs, error: pingError };
  }
  return { status: 'up', latencyMs };
}

/**
 * A REAL queue read, not a boolean. ISC-10: `isReady` only reflects whether
 * `initialize()` was called, not whether Redis can actually answer a BullMQ
 * command right now.
 */
export async function checkQueue(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const counts = await withTimeout(transcriptionQueue.getJobCounts(), READY_TIMEOUTS.queueMs, 'queue getJobCounts');
    return { status: 'up', latencyMs: Date.now() - start, counts };
  } catch (error) {
    return { status: 'down', latencyMs: Date.now() - start, error: errorMessage(error) };
  }
}

/** ISC-12: readiness reflects the live server-error rate, not just liveness. */
export function checkRequests(): CheckResult {
  const s = requestStatsSnapshot();
  return {
    status: s.degraded ? 'degraded' : 'up',
    total: s.total,
    serverErrors: s.serverErrors,
    serverErrorRate: s.serverErrorRate,
    windowMs: s.windowMs,
  };
}

/**
 * Soft check: never throws, never fails the probe outside production. In
 * production, an unstarted worker means jobs will never be processed, so it
 * does block readiness there (see the handler in health.ts).
 */
export function checkWorker(): CheckResult {
  try {
    return { status: transcriptionWorker.running ? 'up' : 'down' };
  } catch (error) {
    return { status: 'down', error: errorMessage(error) };
  }
}

/** Soft check: whisper binary availability never affects the HTTP status. */
export async function checkWhisper(): Promise<CheckResult> {
  try {
    const { available, path } = await withTimeout(
      fasterWhisperService.checkBinaryAvailability(),
      READY_TIMEOUTS.fsMs,
      'whisper binary check'
    );
    return available ? { status: 'up', path } : { status: 'down', path, error: `not executable: ${path}` };
  } catch (error) {
    return { status: 'down', error: errorMessage(error) };
  }
}

/**
 * Soft check (previously hard). A missing watch directory in a fresh
 * deploy or a test environment is a false alarm, not a readiness failure.
 */
export async function checkFileWatcher(): Promise<CheckResult> {
  try {
    const running = fileWatcher.running;
    const dir = await directoryAccess(appConfig.processing.watchDirectory);
    const directoryAccessible = dir.ok;
    const result: CheckResult = {
      status: running && directoryAccessible ? 'up' : 'down',
      running,
      directoryAccessible,
    };
    if (!running) result.error = 'file watcher not running';
    else if (!directoryAccessible) result.error = `watch directory: ${dir.reason}`;
    return result;
  } catch (error) {
    return { status: 'down', error: errorMessage(error) };
  }
}
