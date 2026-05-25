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
 * the counter values via getCount() helpers below.
 *
 * Single source of truth = prom-client registry. JSON view = derived.
 */

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

/** prom-client's Counter doesn't expose a typed read; this is the documented escape hatch. */
function readCounter(counter: { hashMap: Record<string, { value: number }> }): number {
  // Counters with no labels are keyed by the empty string in hashMap.
  const entry = counter.hashMap[''];
  return entry ? entry.value : 0;
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
  incrementDedupSaved(by = 1): void {
    dedupSavedTotal.inc(by);
    // Log on every 10-count threshold crossing — visible even without
    // dashboards. Threshold-crossing math survives multi-increment calls.
    const current = readCounter(dedupSavedTotal as any);
    const currentDecile = Math.floor(current / 10);
    if (currentDecile > this.lastDedupLoggedDecile) {
      this.lastDedupLoggedDecile = currentDecile;
      logger.info({ dedupSaved: current }, '♻️ dedup_saved milestone');
    }
  }

  snapshot(): MetricsSnapshot {
    return {
      generatedAt: new Date().toISOString(),
      uptimeSeconds: Math.round((Date.now() - this.startedAtMs) / 1000),
      counters: {
        jobsStaged: readCounter(jobsStagedTotal as any),
        jobsArchived: readCounter(jobsArchivedTotal as any),
        jobsFailed: readCounter(jobsTerminalFailedTotal as any),
        dedupSaved: readCounter(dedupSavedTotal as any),
      },
    };
  }

  /** Reset to zero — testing only. Does NOT reset the prom-client counters
   * (prom-client Counters are monotonic by design; tests need a fresh
   * registry). */
  reset(): void {
    this.startedAtMs = Date.now();
    this.lastDedupLoggedDecile = 0;
  }
}

export const metrics = new MetricsService();
