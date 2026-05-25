/**
 * 🔮 Transcription Palantir - Prometheus Metrics
 *
 * Production metrics for monitoring transcription system performance
 */

import { Counter, Gauge, Histogram, Registry } from 'prom-client';

// Create a registry
const registry = new Registry();

// Create metrics
export const queueSize = new Gauge({
  name: 'transcription_queue_size',
  help: 'Number of jobs in the queue by status',
  labelNames: ['status'] as const,
  registers: [registry],
});

export const jobsPending = new Gauge({
  name: 'transcription_jobs_pending',
  help: 'Number of pending jobs',
  registers: [registry],
});

export const jobsProcessing = new Gauge({
  name: 'transcription_jobs_processing',
  help: 'Number of jobs currently being processed',
  registers: [registry],
});

// Story 4.1: Additional required metrics
export const jobsTotal = new Counter({
  name: 'transcription_jobs_total',
  help: 'Total number of transcription jobs by status',
  labelNames: ['status'] as const,
  registers: [registry],
});

export const processingDuration = new Histogram({
  name: 'transcription_processing_duration_seconds',
  help: 'Duration of transcription processing in seconds',
  buckets: [1, 5, 10, 30, 60, 120, 300, 600], // 1s to 10min
  registers: [registry],
});

export const errorsTotal = new Counter({
  name: 'transcription_errors_total',
  help: 'Total number of transcription errors by error code',
  labelNames: ['error_code'] as const,
  registers: [registry],
});

// Phase 3: Phase 2.5 counters folded into the prom-client registry. The
// JSON-snapshot MetricsService is a thin facade over these — single source
// of truth for /metrics scrapes.

export const dedupSavedTotal = new Counter({
  name: 'transcription_dedup_saved_total',
  help: 'Number of inbox files moved to /duplicates/ because the content SHA was already processed. THE key signal of upstream-process regression.',
  registers: [registry],
});

export const jobsStagedTotal = new Counter({
  name: 'transcription_jobs_staged_total',
  help: 'Number of new (non-duplicate) inbox files staged into the private working tree.',
  registers: [registry],
});

export const jobsArchivedTotal = new Counter({
  name: 'transcription_jobs_archived_total',
  help: 'Number of jobs that transcribed successfully and archived their inbox source.',
  registers: [registry],
});

export const jobsTerminalFailedTotal = new Counter({
  name: 'transcription_jobs_terminal_failed_total',
  help: 'Number of jobs that exhausted all retries and were terminally failed (work dir cleaned up, inbox source preserved for manual recovery).',
  registers: [registry],
});

export async function getMetrics(): Promise<string> {
  return registry.metrics();
}

export async function getMetricsJSON(): Promise<any[]> {
  return registry.getMetricsAsJSON();
}
