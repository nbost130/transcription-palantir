/**
 * 🔮 Transcription Palantir - Prometheus Metrics
 *
 * Stub implementation for metrics - to be properly implemented later
 */

import { Gauge, Registry } from 'prom-client';

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

export async function getMetrics(): Promise<string> {
  return registry.metrics();
}

export async function getMetricsJSON(): Promise<any[]> {
  return registry.getMetricsAsJSON();
}
