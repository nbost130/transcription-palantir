/**
 * 🔮 Transcription Palantir - Metrics Routes
 *
 * Prometheus metrics and monitoring endpoints
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import {
  getMetrics,
  getMetricsJSON,
  queueSize,
  jobsPending,
  jobsProcessing,
} from '../../services/metrics/prometheus.js';
import { transcriptionQueue } from '../../services/queue.js';

// =============================================================================
// METRICS ROUTES
// =============================================================================

export async function metricsRoutes(
  fastify: FastifyInstance,
  opts: FastifyPluginOptions
): Promise<void> {

  // ---------------------------------------------------------------------------
  // Prometheus Metrics (Text Format)
  // ---------------------------------------------------------------------------

  fastify.get('/metrics', {
    schema: {
      description: 'Prometheus metrics endpoint (text format)',
      tags: ['metrics'],
      response: {
        200: {
          type: 'string',
          description: 'Metrics in Prometheus text format',
        },
      },
    },
  }, async (request, reply) => {
    // Update queue metrics before returning
    const stats = await transcriptionQueue.getQueueStats();
    queueSize.set({ status: 'waiting' }, stats.waiting);
    queueSize.set({ status: 'active' }, stats.active);
    queueSize.set({ status: 'completed' }, stats.completed);
    queueSize.set({ status: 'failed' }, stats.failed);
    jobsPending.set(stats.waiting);
    jobsProcessing.set(stats.active);

    const metrics = await getMetrics();
    reply.type('text/plain');
    return metrics;
  });

  // ---------------------------------------------------------------------------
  // Metrics JSON (for debugging/dashboards)
  // ---------------------------------------------------------------------------

  fastify.get('/metrics/json', {
    schema: {
      description: 'Metrics in JSON format',
      tags: ['metrics'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array' },
            timestamp: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    // Update metrics
    const stats = await transcriptionQueue.getQueueStats();
    queueSize.set({ status: 'waiting' }, stats.waiting);
    queueSize.set({ status: 'active' }, stats.active);
    jobsPending.set(stats.waiting);
    jobsProcessing.set(stats.active);

    const metrics = await getMetricsJSON();
    return {
      success: true,
      data: metrics,
      timestamp: new Date().toISOString(),
    };
  });
}
