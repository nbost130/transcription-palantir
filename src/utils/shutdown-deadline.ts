/**
 * 🔮 Transcription Palantir - Shutdown Deadline
 *
 * A process that has decided to shut down MUST exit. On 2026-09-04 a
 * self-initiated SIGTERM ran the graceful path, the worker's force-close
 * awaited a Redis `quit()` that never resolved, `process.exit` was never
 * reached, and the process lived for two more days answering HTTP with its
 * file watcher stopped. systemd's TimeoutStopSec only covers stops systemd
 * itself initiated; this covers the rest.
 */

import { logger } from './logger.js';

/**
 * Worker graceful close waits up to 60 s for the in-flight job, then
 * force-closes; 90 s leaves headroom for the remaining components.
 */
export const SHUTDOWN_HARD_LIMIT_MS = 90_000;

export type ExitFn = (code: number) => void;

/**
 * Arm a hard exit. Returns a function that cancels it (call after a
 * successful graceful stop). The timer is unref'd so it never keeps an
 * otherwise-finished process alive.
 */
export function armShutdownDeadline(
  ms: number = SHUTDOWN_HARD_LIMIT_MS,
  exit: ExitFn = (code) => process.exit(code)
): () => void {
  const timer = setTimeout(() => {
    logger.fatal({ deadlineMs: ms }, 'Graceful shutdown exceeded its deadline; exiting now');
    exit(1);
  }, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
}
