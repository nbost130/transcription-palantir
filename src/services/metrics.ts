/**
 * 🔮 Transcription Palantir - Metrics Service (facade)
 *
 * Phase 3: this used to be the in-process source of truth for Phase 2.5
 * counters. Those counters now live in the prom-client registry (see
 * src/services/metrics/prometheus.ts) so /api/v1/metrics (Prometheus
 * text) reflects them automatically and scrapers can alert.
 *
 * This module is a thin facade: file-watcher and worker still call
 * `metrics.incrementDedupSaved()` etc., but underneath we're incrementing
 * the prom-client Counter. The /api/v1/dedup-stats JSON endpoint reads
 * values via the official async counter.get() API.
 *
 * Single source of truth = prom-client registry. JSON view = derived.
 */

import type { Counter } from 'prom-client';
import { logger } from '../utils/logger.js';
import { dedupSavedTotal, jobsArchivedTotal, jobsStagedTotal, jobsTerminalFailedTotal } from './metrics/prometheus.js';

export interface MetricsSnapshot {
  generatedAt: string;
  uptimeSeconds: number;
  counters: {
    jobsStaged: number;
    jobsArchived: number;
    jobsFailed: number;
    dedupSaved: number;
  };
}

/**
 * Read a prom-client Counter's current value via the official async API.
 * Counters without labels report a single entry with the empty label set.
 */
async function readCounter(counter: Counter<string>): Promise<number> {
  const snapshot = await counter.get();
  // No labels → the only entry is the aggregate. Sum defensively.
  return snapshot.values.reduce((acc, v) => acc + (v.value ?? 0), 0);
}

export class MetricsService {
  private startedAtMs = Date.now();
  private lastDedupLoggedDecile = 0;

  incrementJobsStaged(by = 1): void {
    jobsStagedTotal.inc(by);
  }
  incrementJobsArchived(by = 1): void {
    jobsArchivedTotal.inc(by);
  }
  incrementJobsFailed(by = 1): void {
    jobsTerminalFailedTotal.inc(by);
  }
  /**
   * Increment the dedup-saved counter and log a milestone on every
   * 10-count threshold crossing. The threshold-crossing math survives
   * multi-increment calls (`by > 1`) without missing a milestone.
   *
   * Note: this `void`-returning method intentionally does not await the
   * read for the log decision; we use a fast cached lastDedupLoggedDecile
   * and best-effort fetch the current value. If the value read fails the
   * milestone log is skipped — the counter increment is the load-bearing
   * effect and that already happened.
   */
  incrementDedupSaved(by = 1): void {
    dedupSavedTotal.inc(by);
    void this.maybeLogDedupMilestone();
  }

  private async maybeLogDedupMilestone(): Promise<void> {
    try {
      const current = await readCounter(dedupSavedTotal);
      const currentDecile = Math.floor(current / 10);
      if (currentDecile > this.lastDedupLoggedDecile) {
        this.lastDedupLoggedDecile = currentDecile;
        logger.info({ dedupSaved: current }, '♻️ dedup_saved milestone');
      }
    } catch (err) {
      logger.debug({ err }, 'Failed to read dedup counter for milestone log');
    }
  }

  async snapshot(): Promise<MetricsSnapshot> {
    const [jobsStaged, jobsArchived, jobsFailed, dedupSaved] = await Promise.all([
      readCounter(jobsStagedTotal),
      readCounter(jobsArchivedTotal),
      readCounter(jobsTerminalFailedTotal),
      readCounter(dedupSavedTotal),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      uptimeSeconds: Math.round((Date.now() - this.startedAtMs) / 1000),
      counters: { jobsStaged, jobsArchived, jobsFailed, dedupSaved },
    };
  }

  /**
   * Reset uptime baseline and milestone tracker — testing only.
   * Does NOT reset the prom-client counters (Counters are monotonic by
   * design; tests should compute deltas).
   */
  reset(): void {
    this.startedAtMs = Date.now();
    this.lastDedupLoggedDecile = 0;
  }
}

export const metrics = new MetricsService();
