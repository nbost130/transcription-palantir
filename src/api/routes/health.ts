/**
 * 🔮 Transcription Palantir - Health Check Routes
 *
 * System health and readiness endpoints
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { transcriptionQueue } from '../../services/queue.js';
import { appConfig } from '../../config/index.js';
import type { SystemHealth, ServiceHealth } from '../../types/index.js';

// =============================================================================
// HEALTH ROUTES
// =============================================================================

export async function healthRoutes(
  fastify: FastifyInstance,
  opts: FastifyPluginOptions
): Promise<void> {

  // ---------------------------------------------------------------------------
  // Liveness Probe
  // ---------------------------------------------------------------------------

  fastify.get('/health', {
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
  }, async (request, reply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  });

  // ---------------------------------------------------------------------------
  // Readiness Probe
  // ---------------------------------------------------------------------------

  fastify.get('/ready', {
    schema: {
      description: 'Readiness check with service status',
      tags: ['health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            services: { type: 'array' },
            timestamp: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const services: ServiceHealth[] = [];

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

    // TODO: Add more service checks
    // - Redis connection
    // - Worker availability
    // - Disk space
    // - File system access

    const allServicesUp = services.every(s => s.status === 'up');
    const statusCode = allServicesUp ? 200 : 503;

    reply.code(statusCode);
    return {
      status: allServicesUp ? 'ready' : 'not ready',
      services,
      timestamp: new Date().toISOString(),
    };
  });

  // ---------------------------------------------------------------------------
  // Detailed System Health
  // ---------------------------------------------------------------------------

  fastify.get('/health/detailed', {
    schema: {
      description: 'Detailed system health with metrics',
      tags: ['health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
            uptime: { type: 'number' },
            version: { type: 'string' },
            services: { type: 'array' },
            metrics: { type: 'object' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const services: ServiceHealth[] = [];

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

    // Get queue statistics
    let queueStats = {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      total: 0,
    };

    try {
      if (transcriptionQueue.isReady) {
        queueStats = await transcriptionQueue.getQueueStats();
      }
    } catch (error) {
      // Stats unavailable
    }

    // Get system metrics
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const health: SystemHealth = {
      status: services.every(s => s.status === 'up') ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      services,
      metrics: {
        jobs: {
          total: queueStats.total,
          pending: queueStats.waiting,
          processing: queueStats.active,
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
          size: queueStats.waiting + queueStats.active,
          throughput: 0, // TODO: Calculate throughput
          avgProcessingTime: 0, // TODO: Calculate average processing time
        },
      },
    };

    return health;
  });

  // ---------------------------------------------------------------------------
  // Startup Probe
  // ---------------------------------------------------------------------------

  fastify.get('/startup', {
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
  }, async (request, reply) => {
    const initialized = transcriptionQueue.isReady;

    return {
      status: initialized ? 'started' : 'starting',
      initialized,
      timestamp: new Date().toISOString(),
    };
  });
}
