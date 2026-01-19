/**
 * 🔮 Transcription Palantir - Health Check Routes
 *
 * System health and readiness endpoints
 */

import { access, constants } from 'node:fs/promises';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { appConfig } from '../../config/index.js';
import { fasterWhisperService } from '../../services/faster-whisper.js';
import { fileWatcher } from '../../services/file-watcher.js';
import { transcriptionQueue } from '../../services/queue.js';
import type { DirectoryHealth, ServiceHealth } from '../../types/index.js';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function checkDirectoryAccess(dirPath: string): Promise<boolean> {
  try {
    await access(dirPath, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function getQueueServiceHealth(): Promise<ServiceHealth> {
  const queueStartTime = Date.now();
  try {
    const isQueueReady = transcriptionQueue.isReady;
    const queueResponseTime = Date.now() - queueStartTime;

    return {
      name: 'queue',
      status: isQueueReady ? 'up' : 'down',
      lastCheck: new Date().toISOString(),
      responseTime: queueResponseTime,
    };
  } catch (error) {
    return {
      name: 'queue',
      status: 'down',
      lastCheck: new Date().toISOString(),
      error: (error as Error).message,
    };
  }
}

async function getFileWatcherServiceHealth(): Promise<ServiceHealth> {
  const watcherStartTime = Date.now();
  try {
    const watcherRunning = fileWatcher.running;
    const watcherResponseTime = Date.now() - watcherStartTime;
    const watchDirAccessible = await checkDirectoryAccess(appConfig.processing.watchDirectory);

    return {
      name: 'file_watcher',
      status: watcherRunning && watchDirAccessible ? 'up' : 'down',
      lastCheck: new Date().toISOString(),
      responseTime: watcherResponseTime,
      metadata: {
        watching: watcherRunning,
        directory: appConfig.processing.watchDirectory,
        directoryAccessible: watchDirAccessible,
        processedFiles: fileWatcher.processedCount,
      },
    };
  } catch (error) {
    return {
      name: 'file_watcher',
      status: 'down',
      lastCheck: new Date().toISOString(),
      error: (error as Error).message,
      metadata: {
        directory: appConfig.processing.watchDirectory,
      },
    };
  }
}

async function getQueueStats() {
  const defaultStats = {
    waiting: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  };

  try {
    if (!transcriptionQueue.isReady) {
      return defaultStats;
    }

    const stats = await transcriptionQueue.getQueueStats();
    return {
      waiting: stats.waiting,
      processing: stats.active,
      completed: stats.completed,
      failed: stats.failed,
    };
  } catch {
    return defaultStats;
  }
}

async function getDirectoryHealth(): Promise<DirectoryHealth[]> {
  const now = new Date().toISOString();
  const directories = [
    { name: 'watch', path: appConfig.processing.watchDirectory },
    { name: 'output', path: appConfig.processing.outputDirectory },
    { name: 'completed', path: appConfig.processing.completedDirectory },
    { name: 'failed', path: appConfig.processing.failedDirectory },
  ];

  const checks = await Promise.all(
    directories.map(async (directory) => {
      const accessible = await checkDirectoryAccess(directory.path);
      const result: DirectoryHealth = {
        name: directory.name,
        path: directory.path,
        accessible,
        lastChecked: now,
      };

      if (!accessible) {
        result.note = 'Path missing or lacks permissions';
      }

      return result;
    })
  );

  return checks;
}

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

  fastify.get(
    '/ready',
    {
      schema: {
        description: 'Readiness check with service status',
        tags: ['health'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              services: { type: 'array' },
              paths: { type: 'array' },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const services: ServiceHealth[] = [];
      const paths = await getDirectoryHealth();

      // Check Queue Service
      try {
        const isQueueReady = transcriptionQueue.isReady;
        services.push({
          name: 'queue',
          status: isQueueReady ? 'up' : 'down',
          lastCheck: new Date().toISOString(),
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
      try {
        const watcherRunning = fileWatcher.running;
        const watchDirAccessible = await checkDirectoryAccess(appConfig.processing.watchDirectory);

        services.push({
          name: 'file_watcher',
          status: watcherRunning && watchDirAccessible ? 'up' : 'down',
          lastCheck: new Date().toISOString(),
          metadata: {
            watching: watcherRunning,
            directoryAccessible: watchDirAccessible,
          },
        });
      } catch (error) {
        services.push({
          name: 'file_watcher',
          status: 'down',
          lastCheck: new Date().toISOString(),
          error: (error as Error).message,
        });
      }

      const allServicesUp = services.every((s) => s.status === 'up');
      const statusCode = allServicesUp ? 200 : 503;

      reply.code(statusCode);
      return {
        status: allServicesUp ? 'ready' : 'not ready',
        services,
        paths,
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
              paths: { type: 'array' },
              metrics: { type: 'object' },
            },
          },
        },
      },
    },
    async (_request, _reply) => {
      // Collect all health data
      const [paths, whisperHealth, queueService, fileWatcherService, queueStats] = await Promise.all([
        getDirectoryHealth(),
        fasterWhisperService.getHealthStatus(),
        getQueueServiceHealth(),
        getFileWatcherServiceHealth(),
        getQueueStats(),
      ]);

      const services = [queueService, fileWatcherService];
      const redisStatus = transcriptionQueue.isReady ? 'connected' : 'disconnected';

      // Determine overall health
      const isHealthy =
        services.every((s) => s.status === 'up') &&
        whisperHealth.whisperBinaryStatus === 'available' &&
        redisStatus === 'connected';

      // Get system metrics
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();

      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0',
        whisperBinaryStatus: whisperHealth.whisperBinaryStatus,
        whisperVersion: whisperHealth.whisperVersion,
        redisStatus,
        queueStats,
        services,
        paths,
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
            cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000000,
            memoryUsage: memUsage.heapUsed / 1024 / 1024,
            diskUsage: 0, // TODO: Implement disk usage tracking
          },
          queue: {
            size: queueStats.waiting + queueStats.processing,
            throughput: 0, // TODO: Calculate throughput
            avgProcessingTime: 0, // TODO: Calculate average processing time
          },
        },
      };
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
}
