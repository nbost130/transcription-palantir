/**
 * 🔮 Transcription Palantir - Monitoring Dashboard Routes
 *
 * Real-time queue and worker monitoring endpoints
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { appConfig } from '../../config/index.js';
import { transcriptionQueue } from '../../services/queue.js';
import { type ApiResponse, JobStatus } from '../../types/index.js';

// =============================================================================
// MONITORING ROUTES
// =============================================================================

export async function monitorRoutes(fastify: FastifyInstance, opts: FastifyPluginOptions): Promise<void> {
  // ---------------------------------------------------------------------------
  // Queue Dashboard Data
  // ---------------------------------------------------------------------------

  fastify.get(
    '/monitor/queue',
    {
      schema: {
        description: 'Get queue monitoring dashboard data',
        tags: ['monitoring'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const stats = await transcriptionQueue.getQueueStats();

      // Get recent jobs from each status
      const [waitingJobs, activeJobs, completedJobs, failedJobs] = await Promise.all([
        transcriptionQueue.getJobs(JobStatus.PENDING, 0, 4),
        transcriptionQueue.getJobs(JobStatus.PROCESSING, 0, 4),
        transcriptionQueue.getJobs(JobStatus.COMPLETED, 0, 9),
        transcriptionQueue.getJobs(JobStatus.FAILED, 0, 4),
      ]);

      const response: ApiResponse = {
        success: true,
        data: {
          stats,
          recentJobs: {
            waiting: waitingJobs.map((j) => ({
              id: j.id,
              name: j.data.fileName,
              priority: j.data.priority,
              timestamp: j.timestamp,
            })),
            active: activeJobs.map((j) => ({
              id: j.id,
              name: j.data.fileName,
              progress: j.progress,
              processedOn: j.processedOn,
            })),
            completed: completedJobs.map((j) => ({
              id: j.id,
              name: j.data.fileName,
              finishedOn: j.finishedOn,
              duration: j.finishedOn && j.processedOn ? j.finishedOn - j.processedOn : null,
            })),
            failed: failedJobs.map((j) => ({
              id: j.id,
              name: j.data.fileName,
              failedReason: j.failedReason,
              attemptsMade: j.attemptsMade,
            })),
          },
          throughput: {
            completedLast5Min: completedJobs.filter((j) => j.finishedOn && Date.now() - j.finishedOn < 300000).length,
            failedLast5Min: failedJobs.filter((j) => j.finishedOn && Date.now() - j.finishedOn < 300000).length,
          },
        },
        timestamp: new Date().toISOString(),
        requestId: request.id,
      };

      return response;
    }
  );

  // ---------------------------------------------------------------------------
  // Worker Status
  // ---------------------------------------------------------------------------

  fastify.get(
    '/monitor/workers',
    {
      schema: {
        description: 'Get worker status and statistics',
        tags: ['monitoring'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const stats = await transcriptionQueue.getQueueStats();

      const response: ApiResponse = {
        success: true,
        data: {
          workers: {
            configured: {
              min: appConfig.processing.minWorkers, // From config
              max: appConfig.processing.maxWorkers, // From config
            },
            active: stats.active,
            idle: Math.max(0, appConfig.processing.maxWorkers - stats.active), // Estimated
            utilization: stats.active > 0 ? (stats.active / appConfig.processing.maxWorkers) * 100 : 0,
          },
          performance: {
            jobsInProgress: stats.active,
            queueDepth: stats.waiting,
            avgWaitTime: null, // TODO: Calculate from job timestamps
          },
          health: {
            status: stats.active === 0 && stats.waiting > 0 ? 'degraded' : 'healthy',
            lastJobProcessed: null, // TODO: Get from last completed job
          },
        },
        timestamp: new Date().toISOString(),
        requestId: request.id,
      };

      return response;
    }
  );

  // ---------------------------------------------------------------------------
  // System Status Summary
  // ---------------------------------------------------------------------------

  fastify.get(
    '/monitor/status',
    {
      schema: {
        description: 'Get overall system status summary',
        tags: ['monitoring'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const stats = await transcriptionQueue.getQueueStats();
      const memUsage = process.memoryUsage();

      const response: ApiResponse = {
        success: true,
        data: {
          overview: {
            status: 'operational',
            uptime: process.uptime(),
            version: '1.0.0',
          },
          queue: {
            total: stats.total,
            pending: stats.waiting,
            processing: stats.active,
            completed: stats.completed,
            failed: stats.failed,
            health: stats.failed / Math.max(1, stats.total) < 0.1 ? 'healthy' : 'degraded',
          },
          workers: {
            active: stats.active,
            maxConcurrency: appConfig.processing.maxWorkers,
          },
          system: {
            memoryUsageMB: Math.round(memUsage.heapUsed / 1024 / 1024),
            memoryTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
            cpuUsagePercent: null, // TODO: Implement CPU tracking
          },
          alerts: [],
        },
        timestamp: new Date().toISOString(),
        requestId: request.id,
      };

      // Add alerts for issues
      const alerts: string[] = [];
      if (stats.waiting > 100) {
        alerts.push('High queue depth: ' + stats.waiting + ' jobs waiting');
      }
      if (stats.failed > 10) {
        alerts.push('Multiple failed jobs: ' + stats.failed + ' failures');
      }
      if (stats.active === 0 && stats.waiting > 0) {
        alerts.push('Workers idle with pending jobs');
      }

      (response.data as any).alerts = alerts;

      return response;
    }
  );

  // ---------------------------------------------------------------------------
  // Job Timeline
  // ---------------------------------------------------------------------------

  fastify.get(
    '/monitor/timeline',
    {
      schema: {
        description: 'Get job processing timeline for visualization',
        tags: ['monitoring'],
        querystring: {
          type: 'object',
          properties: {
            hours: { type: 'number', minimum: 1, maximum: 24, default: 1 },
          },
        },
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
    },
    async (request, reply) => {
      const { hours = 1 } = request.query as { hours?: number };

      // Get completed and failed jobs
      const [completed, failed] = await Promise.all([
        transcriptionQueue.getJobs(JobStatus.COMPLETED, 0, 99),
        transcriptionQueue.getJobs(JobStatus.FAILED, 0, 99),
      ]);

      const cutoffTime = Date.now() - hours * 60 * 60 * 1000;

      const timeline = [
        ...completed
          .filter((j) => j.finishedOn && j.finishedOn > cutoffTime)
          .map((j) => ({
            timestamp: j.finishedOn,
            type: 'completed',
            jobId: j.id,
            fileName: j.data.fileName,
            duration: j.finishedOn && j.processedOn ? j.finishedOn - j.processedOn : null,
          })),
        ...failed
          .filter((j) => j.finishedOn && j.finishedOn > cutoffTime)
          .map((j) => ({
            timestamp: j.finishedOn,
            type: 'failed',
            jobId: j.id,
            fileName: j.data.fileName,
            reason: j.failedReason,
          })),
      ].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      const response: ApiResponse = {
        success: true,
        data: timeline,
        timestamp: new Date().toISOString(),
        requestId: request.id,
      };

      return response;
    }
  );
}
