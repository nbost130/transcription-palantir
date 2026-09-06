/**
 * 🔮 Transcription Palantir - Health Check Routes
 *
 * System health and readiness endpoints
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { appConfig } from '../../config/index.js';
import { fasterWhisperService } from '../../services/faster-whisper.js';
import { fileWatcher } from '../../services/file-watcher.js';
import { metrics } from '../../services/metrics.js';
import { transcriptionQueue } from '../../services/queue.js';
import type { ServiceHealth, SystemHealth } from '../../types/index.js';
import {
  checkDirectoryAccess,
  checkFileWatcher,
  checkQueue,
  checkRedis,
  checkRequests,
  checkWhisper,
  checkWorker,
  READY_TIMEOUTS,
} from './health-checks.js';

export { READY_TIMEOUTS };

// =============================================================================
// HEALTH ROUTES
// =============================================================================

export async function healthRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
  // ---------------------------------------------------------------------------
  // Liveness Probe
  // ---------------------------------------------------------------------------

  fastify.get(
    '/health',
    {
      schema: {
        description: 'Basic liveness check',
        tags: ['health'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' },
              uptime: { type: 'number' },
            },
          },
        },
      },
    },
    async (_request, _reply) => {
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      };
    }
  );

  // ---------------------------------------------------------------------------
  // Readiness Probe
  // ---------------------------------------------------------------------------
  //
  // Unlike /health, this endpoint reaches out: a real Redis ping, a real
  // BullMQ queue read, and the live in-process server-error rate. That's the
  // seam that was missing when /api/v1/jobs was 500ing for 7 of every 15
  // minutes while this endpoint kept saying "ok" (see ISA.md). "Hard" checks
  // (redis, queue, requests) can turn the HTTP status to 503; "soft" checks
  // (worker, whisper, file_watcher) are reported but never fail the probe
  // outside production, where an unstarted worker also fails it.

  // `additionalProperties: true` on `checks` (and each check within it) is
  // load-bearing: fast-json-stringify treats a bare `{ type: 'object' }` with
  // no declared shape as empty and serializes `{}`, silently dropping every
  // field the checks below produce.
  const checkSchema = { type: 'object', additionalProperties: true };
  const readyResponseSchema = {
    type: 'object',
    additionalProperties: true,
    properties: {
      status: { type: 'string' },
      checks: {
        type: 'object',
        additionalProperties: true,
        properties: {
          redis: checkSchema,
          queue: checkSchema,
          requests: checkSchema,
          worker: checkSchema,
          whisper: checkSchema,
          file_watcher: checkSchema,
        },
      },
      services: { type: 'array' },
      timestamp: { type: 'string' },
    },
  };

  fastify.get(
    '/ready',
    {
      schema: {
        description: 'Readiness check: Redis, queue, request error rate, worker, whisper, file watcher',
        tags: ['health'],
        response: {
          200: readyResponseSchema,
          503: readyResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const [redis, queue, whisper, fileWatcherCheck] = await Promise.all([
        checkRedis(),
        checkQueue(),
        checkWhisper(),
        checkFileWatcher(),
      ]);
      const requests = checkRequests();
      const worker = checkWorker();

      const checks = {
        redis,
        queue,
        requests,
        worker,
        whisper,
        file_watcher: fileWatcherCheck,
      };

      const hardChecksPass = redis.status === 'up' && queue.status === 'up' && requests.status !== 'degraded';
      // Soft everywhere except production, where a stopped worker means jobs
      // never process even though Redis and the queue read are fine.
      const workerBlocksReadiness = appConfig.env === 'production' && worker.status !== 'up';
      const ready = hardChecksPass && !workerBlocksReadiness;

      reply.code(ready ? 200 : 503);

      // Backward-compat `services` array for existing consumers.
      const services: ServiceHealth[] = [
        {
          name: 'queue',
          status: queue.status,
          lastCheck: new Date().toISOString(),
          ...(queue.latencyMs !== undefined && { responseTime: queue.latencyMs }),
          ...(queue.error !== undefined && { error: queue.error }),
        },
        {
          name: 'file_watcher',
          status: fileWatcherCheck.status,
          lastCheck: new Date().toISOString(),
          metadata: {
            watching: fileWatcherCheck.running,
            directoryAccessible: fileWatcherCheck.directoryAccessible,
          },
        },
      ];

      return {
        status: ready ? 'ready' : 'not ready',
        checks,
        services,
        timestamp: new Date().toISOString(),
      };
    }
  );

  // ---------------------------------------------------------------------------
  // Detailed System Health
  // ---------------------------------------------------------------------------

  fastify.get(
    '/health/detailed',
    {
      schema: {
        description: 'Detailed system health with metrics (Story 2.6)',
        tags: ['health'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' },
              uptime: { type: 'number' },
              version: { type: 'string' },
              whisperBinaryStatus: { type: 'string' },
              whisperVersion: { type: ['string', 'null'] },
              redisStatus: { type: 'string' },
              queueStats: { type: 'object' },
              services: { type: 'array' },
              metrics: { type: 'object' },
            },
          },
        },
      },
    },
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: pre-existing complexity
    async (_request, _reply) => {
      const services: ServiceHealth[] = [];

      // Check Whisper binary status (Story 2.6)
      const whisperHealth = await fasterWhisperService.getHealthStatus();

      // Check Redis status (Story 2.6)
      const redisStatus = transcriptionQueue.isReady ? 'connected' : 'disconnected';

      // Check Queue Service
      const queueStartTime = Date.now();
      try {
        const isQueueReady = transcriptionQueue.isReady;
        const queueResponseTime = Date.now() - queueStartTime;

        services.push({
          name: 'queue',
          status: isQueueReady ? 'up' : 'down',
          lastCheck: new Date().toISOString(),
          responseTime: queueResponseTime,
        });
      } catch (error) {
        services.push({
          name: 'queue',
          status: 'down',
          lastCheck: new Date().toISOString(),
          error: (error as Error).message,
        });
      }

      // Check File Watcher Service
      const watcherStartTime = Date.now();
      try {
        const watcherRunning = fileWatcher.running;
        const watcherResponseTime = Date.now() - watcherStartTime;

        // Verify watch directory is still accessible
        const watchDirAccessible = await checkDirectoryAccess(appConfig.processing.watchDirectory);

        services.push({
          name: 'file_watcher',
          status: watcherRunning && watchDirAccessible ? 'up' : 'down',
          lastCheck: new Date().toISOString(),
          responseTime: watcherResponseTime,
          metadata: {
            watching: watcherRunning,
            directory: appConfig.processing.watchDirectory, // Added from origin/main
            directoryAccessible: watchDirAccessible,
            processedFiles: fileWatcher.processedCount,
          },
        });
      } catch (error) {
        services.push({
          name: 'file_watcher',
          status: 'down',
          lastCheck: new Date().toISOString(),
          error: (error as Error).message,
          metadata: {
            directory: appConfig.processing.watchDirectory, // Added from origin/main
          },
        });
      }

      // Get queue statistics (Story 2.6 format)
      let queueStats = {
        waiting: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      };

      try {
        if (transcriptionQueue.isReady) {
          const stats = await transcriptionQueue.getQueueStats();
          queueStats = {
            waiting: stats.waiting,
            processing: stats.active,
            completed: stats.completed,
            failed: stats.failed,
          };
        }
      } catch (_error) {
        // Stats unavailable
      }

      // Get system metrics
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();

      // Determine overall health status (Story 2.6)
      const isHealthy =
        services.every((s) => s.status === 'up') &&
        whisperHealth.whisperBinaryStatus === 'available' &&
        redisStatus === 'connected';

      const health: SystemHealth & {
        whisperBinaryStatus: 'available' | 'missing';
        whisperVersion: string | null;
        redisStatus: 'connected' | 'disconnected';
        queueStats: typeof queueStats;
      } = {
        status: isHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0',
        whisperBinaryStatus: whisperHealth.whisperBinaryStatus,
        whisperVersion: whisperHealth.whisperVersion,
        redisStatus,
        queueStats,
        services,
        metrics: {
          jobs: {
            total: queueStats.waiting + queueStats.processing + queueStats.completed + queueStats.failed,
            pending: queueStats.waiting,
            processing: queueStats.processing,
            completed: queueStats.completed,
            failed: queueStats.failed,
          },
          workers: {
            active: 0, // TODO: Implement worker tracking
            idle: 0,
            total: 0,
          },
          system: {
            cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to seconds
            memoryUsage: memUsage.heapUsed / 1024 / 1024, // Convert to MB
            diskUsage: 0, // TODO: Implement disk usage tracking
          },
          queue: {
            size: queueStats.waiting + queueStats.processing,
            throughput: 0, // TODO: Calculate throughput
            avgProcessingTime: 0, // TODO: Calculate average processing time
          },
        },
      };

      return health;
    }
  );

  // ---------------------------------------------------------------------------
  // Startup Probe
  // ---------------------------------------------------------------------------

  fastify.get(
    '/startup',
    {
      schema: {
        description: 'Startup check for initialization status',
        tags: ['health'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              initialized: { type: 'boolean' },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request, _reply) => {
      const initialized = transcriptionQueue.isReady;

      return {
        status: initialized ? 'started' : 'starting',
        initialized,
        timestamp: new Date().toISOString(),
      };
    }
  );

  // ---------------------------------------------------------------------------
  // Dedup stats (Phase 2.5)
  // ---------------------------------------------------------------------------
  // Lives at /dedup-stats (not /metrics) because there's already a Prometheus
  // /metrics endpoint exposing prom-client counters via metricsRoutes. Phase 3
  // will fold these counters into the prom-client registry; for now this is a
  // focused JSON endpoint so the dedup-saved KPI is at least observable.

  fastify.get(
    '/dedup-stats',
    {
      schema: {
        description:
          'Phase 2.5 in-process counters as JSON: dedupSaved, jobsStaged/Archived/Failed. Phase 3 will migrate these to the Prometheus /metrics endpoint.',
        tags: ['health'],
      },
    },
    async (_request, _reply) => {
      return metrics.snapshot();
    }
  );
}
