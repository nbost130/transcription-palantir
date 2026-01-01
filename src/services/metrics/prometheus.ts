import client from 'prom-client';

// Create a Registry which registers the metrics
const register = new client.Registry();

// Add a default label which is added to all metrics
register.setDefaultLabels({
  app: 'transcription-palantir',
});

// Enable the collection of default metrics
client.collectDefaultMetrics({ register });

// Define metrics
export const queueSize = new client.Gauge({
  name: 'transcription_queue_size',
  help: 'Number of jobs in the queue by status',
  labelNames: ['status'],
  registers: [register],
});

export const jobsPending = new client.Gauge({
  name: 'transcription_jobs_pending',
  help: 'Number of pending jobs',
  registers: [register],
});

export const jobsProcessing = new client.Gauge({
  name: 'transcription_jobs_processing',
  help: 'Number of processing jobs',
  registers: [register],
});

export const jobsCompleted = new client.Gauge({
  name: 'transcription_jobs_completed',
  help: 'Total number of completed jobs',
  registers: [register],
});

export const jobsFailed = new client.Gauge({
  name: 'transcription_jobs_failed',
  help: 'Total number of failed jobs',
  registers: [register],
});

export const jobDuration = new client.Histogram({
  name: 'transcription_job_duration_seconds',
  help: 'Duration of transcription jobs in seconds',
  buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600],
  registers: [register],
});

export async function getMetrics(): Promise<string> {
  return register.metrics();
}

export async function getMetricsJSON(): Promise<any> {
  return register.getMetricsAsJSON();
}
