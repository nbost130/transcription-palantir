/**
 * 🔮 Transcription Palantir - Metrics Service
 *
 * Phase 2.5: in-process counters surfaced via /api/v1/metrics.
 *
 * The whole point of Phase 1 + 2 + 2.5 was "make the bug class visible
 * the day it starts, not the night the box melts." That requires at
 * minimum a `dedupSaved` counter. Without it, the next regression of
 * the duplicate-storm class is invisible again.
 *
 * Intentionally MINIMAL: a single singleton with bare counters and a
 * JSON snapshot. Full prom-client integration (registry + /metrics in
 * Prometheus text format) is Phase 3.
 */

import { logger } from '../utils/logger.js';

export interface MetricsSnapshot {
  generatedAt: string;
  uptimeSeconds: number;
  counters: {
    /** Files staged into the work tree (new content). */
    jobsStaged: number;
    /** Successful transcriptions that archived the source. */
    jobsArchived: number;
    /** Jobs that exhausted retries and were terminally failed. */
    jobsFailed: number;
    /**
     * Files detected as duplicate-content and moved out of the inbox to
     * /duplicates/. THE KEY METRIC: a sustained spike here means an
     * upstream process started re-depositing the same files, and the
     * day it starts is the day we want to know — not the day the box melts.
     */
    dedupSaved: number;
  };
}

export class MetricsService {
  private startedAtMs = Date.now();
  private jobsStaged = 0;
  private jobsArchived = 0;
  private jobsFailed = 0;
  private dedupSaved = 0;

  incrementJobsStaged(by = 1): void {
    this.jobsStaged += by;
  }
  incrementJobsArchived(by = 1): void {
    this.jobsArchived += by;
  }
  incrementJobsFailed(by = 1): void {
    this.jobsFailed += by;
  }
  incrementDedupSaved(by = 1): void {
    const previous = this.dedupSaved;
    this.dedupSaved += by;
    // Log on every 10-count threshold crossing, regardless of step size,
    // so even without dashboards a sustained spike is visible in the log
    // stream. Threshold-crossing math survives multi-increment calls.
    if (Math.floor(previous / 10) < Math.floor(this.dedupSaved / 10)) {
      logger.info({ dedupSaved: this.dedupSaved }, '♻️ dedup_saved milestone');
    }
  }

  snapshot(): MetricsSnapshot {
    return {
      generatedAt: new Date().toISOString(),
      uptimeSeconds: Math.round((Date.now() - this.startedAtMs) / 1000),
      counters: {
        jobsStaged: this.jobsStaged,
        jobsArchived: this.jobsArchived,
        jobsFailed: this.jobsFailed,
        dedupSaved: this.dedupSaved,
      },
    };
  }

  /** Reset to zero — testing only. Not exposed via the API. */
  reset(): void {
    this.startedAtMs = Date.now();
    this.jobsStaged = 0;
    this.jobsArchived = 0;
    this.jobsFailed = 0;
    this.dedupSaved = 0;
  }
}

export const metrics = new MetricsService();
