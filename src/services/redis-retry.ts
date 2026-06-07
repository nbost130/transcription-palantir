/**
 * Redis reconnection strategy for the Transcription Palantir queue.
 *
 * Extracted from queue.ts so it can be unit-tested in isolation.
 *
 * ROOT-CAUSE FIX (2026-06-07): the previous strategy returned `null` (stop
 * reconnecting forever) once the attempt count exceeded REDIS_MAX_RETRIES
 * (default 3). For a long-running, Redis-backed service that is fatal — a
 * single transient Redis blip exhausts 3 retries in ~300ms and kills the
 * connection permanently, after which every queue READ (job status, counts,
 * lists) throws 500 until the process is restarted. The transcription client
 * polls job status every 2s and gives up after ~15 tries, which surfaces to
 * the user as "voice processing timed out at 30 seconds."
 *
 * This strategy NEVER gives up: it always returns a capped backoff delay so the
 * connection recovers from any transient outage on its own.
 */
import { queueLogger } from '../utils/logger.js';

/** Maximum backoff between reconnection attempts (ms). */
export const MAX_RECONNECT_DELAY_MS = 2000;

/** Emit a warning on the first failure, then once every N attempts. */
const LOG_EVERY_N_ATTEMPTS = 20;

/**
 * ioredis `retryStrategy`: given the attempt count, return the delay (ms)
 * before the next reconnection attempt. Always returns a number — never null —
 * so the connection keeps trying indefinitely with capped linear backoff.
 */
export function redisRetryStrategy(times: number): number {
  const delay = Math.min(times * 50, MAX_RECONNECT_DELAY_MS);

  if (times === 1 || times % LOG_EVERY_N_ATTEMPTS === 0) {
    queueLogger.warn({ attempt: times, delayMs: delay }, 'Redis unreachable — reconnecting (will retry indefinitely)');
  }

  return delay;
}
