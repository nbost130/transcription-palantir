/**
 * 🔮 Transcription Palantir - Request Statistics
 *
 * Rolling-window counter of HTTP responses by class, so the readiness
 * endpoint can turn red when requests are failing. This is the seam that
 * was missing when every rate-limited request logged as `"error":{}` and
 * returned 500 for weeks while `/health` said "ok".
 *
 * Writer: the request logger's `finish` handler calls `recordResponse`.
 * Reader: `/api/v1/ready` calls `snapshot()`.
 *
 * Pure in-process state; no Redis, no timers. Old samples are evicted
 * lazily on the next write or read.
 */

/** Length of the rolling window in milliseconds. */
export const WINDOW_MS = 5 * 60_000;

/** Minimum samples before the error rate is considered meaningful. */
export const MIN_SAMPLES = 10;

/** Server-error fraction at or above which readiness reports not-ready. */
export const ERROR_RATE_THRESHOLD = 0.5;

interface Sample {
  at: number;
  statusCode: number;
}

export interface RequestStatsSnapshot {
  windowMs: number;
  total: number;
  clientErrors: number;
  serverErrors: number;
  /** serverErrors / total, or 0 when total is 0. */
  serverErrorRate: number;
  /** True when total >= MIN_SAMPLES and serverErrorRate >= ERROR_RATE_THRESHOLD. */
  degraded: boolean;
}

let samples: Sample[] = [];

function evict(now: number): void {
  const cutoff = now - WINDOW_MS;
  // Samples are appended in time order, so drop the prefix that expired.
  let firstLive = 0;
  while (firstLive < samples.length && samples[firstLive]!.at < cutoff) firstLive++;
  if (firstLive > 0) samples = samples.slice(firstLive);
}

/** Record one finished response. `now` is injectable for tests. */
export function recordResponse(statusCode: number, now: number = Date.now()): void {
  evict(now);
  samples.push({ at: now, statusCode });
}

/** Current window statistics. `now` is injectable for tests. */
export function snapshot(now: number = Date.now()): RequestStatsSnapshot {
  evict(now);
  const total = samples.length;
  let clientErrors = 0;
  let serverErrors = 0;
  for (const s of samples) {
    if (s.statusCode >= 500) serverErrors++;
    else if (s.statusCode >= 400) clientErrors++;
  }
  const serverErrorRate = total === 0 ? 0 : serverErrors / total;
  return {
    windowMs: WINDOW_MS,
    total,
    clientErrors,
    serverErrors,
    serverErrorRate,
    degraded: total >= MIN_SAMPLES && serverErrorRate >= ERROR_RATE_THRESHOLD,
  };
}

/** Clear all samples. Tests only. */
export function reset(): void {
  samples = [];
}
