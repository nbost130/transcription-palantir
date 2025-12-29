/**
 * 🔮 Transcription Palantir - WebSocket Routes
 *
 * Real-time updates via WebSocket
 */

import type { WebSocket } from '@fastify/websocket';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { transcriptionQueue } from '../../services/queue.js';

// =============================================================================
// WEBSOCKET ROUTES
// =============================================================================

export async function websocketRoutes(fastify: FastifyInstance, opts: FastifyPluginOptions): Promise<void> {
  // Track connected clients
  const clients = new Set<WebSocket>();

  // ---------------------------------------------------------------------------
  // Queue Updates WebSocket
  // ---------------------------------------------------------------------------

  fastify.get('/ws/queue', { websocket: true }, (connection, req) => {
    const { socket } = connection;

    // Add client to set
    clients.add(socket);

    console.log(`WebSocket client connected. Total clients: ${clients.size}`);

    // Send initial queue stats
    sendQueueStats(socket);

    // Send updates every 2 seconds
    const interval = setInterval(() => {
      sendQueueStats(socket);
    }, 2000);

    // Handle client messages
    socket.on('message', (message: Buffer) => {
      const data = JSON.parse(message.toString());

      if (data.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      }
    });

    // Handle disconnect
    socket.on('close', () => {
      clearInterval(interval);
      clients.delete(socket);
      console.log(`WebSocket client disconnected. Total clients: ${clients.size}`);
    });

    socket.on('error', (error: Error) => {
      console.error('WebSocket error:', error);
      clearInterval(interval);
      clients.delete(socket);
    });
  });

  // ---------------------------------------------------------------------------
  // Job Progress WebSocket
  // ---------------------------------------------------------------------------

  fastify.get('/ws/jobs/:jobId', { websocket: true }, (connection, req) => {
    const { socket } = connection;
    const { jobId } = req.params as { jobId: string };

    clients.add(socket);

    console.log(`WebSocket client connected for job ${jobId}`);

    // Send job updates every second
    const interval = setInterval(async () => {
      try {
        const job = await transcriptionQueue.getJob(jobId);

        if (!job) {
          socket.send(
            JSON.stringify({
              type: 'error',
              message: 'Job not found',
              timestamp: Date.now(),
            })
          );
          return;
        }

        socket.send(
          JSON.stringify({
            type: 'job_update',
            data: {
              jobId: job.id,
              name: job.data.fileName,
              progress: job.progress || 0,
              state: await job.getState(),
              attemptsMade: job.attemptsMade,
              processedOn: job.processedOn,
              finishedOn: job.finishedOn,
              failedReason: job.failedReason,
            },
            timestamp: Date.now(),
          })
        );

        // Stop updates if job is finished
        if (job.finishedOn) {
          clearInterval(interval);
          socket.send(
            JSON.stringify({
              type: 'job_finished',
              data: {
                jobId: job.id,
                success: !job.failedReason,
              },
              timestamp: Date.now(),
            })
          );
        }
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: 'error',
            message: (error as Error).message,
            timestamp: Date.now(),
          })
        );
      }
    }, 1000);

    socket.on('close', () => {
      clearInterval(interval);
      clients.delete(socket);
    });

    socket.on('error', (error: Error) => {
      console.error('WebSocket error:', error);
      clearInterval(interval);
      clients.delete(socket);
    });
  });

  // ---------------------------------------------------------------------------
  // System Events WebSocket
  // ---------------------------------------------------------------------------

  fastify.get('/ws/events', { websocket: true }, (connection, req) => {
    const { socket } = connection;

    clients.add(socket);

    console.log(`WebSocket client connected for system events`);

    // Send system events
    const sendEvent = (event: any) => {
      socket.send(
        JSON.stringify({
          type: 'system_event',
          event,
          timestamp: Date.now(),
        })
      );
    };

    // Example: Send periodic system health
    const interval = setInterval(async () => {
      const stats = await transcriptionQueue.getQueueStats();
      const memUsage = process.memoryUsage();

      sendEvent({
        category: 'health',
        data: {
          queue: stats,
          memory: {
            heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
          },
          uptime: process.uptime(),
        },
      });
    }, 5000);

    socket.on('close', () => {
      clearInterval(interval);
      clients.delete(socket);
    });

    socket.on('error', (error: Error) => {
      console.error('WebSocket error:', error);
      clearInterval(interval);
      clients.delete(socket);
    });
  });

  // ===========================================================================
  // HELPER FUNCTIONS
  // ===========================================================================

  async function sendQueueStats(socket: WebSocket) {
    try {
      const stats = await transcriptionQueue.getQueueStats();

      socket.send(
        JSON.stringify({
          type: 'queue_stats',
          data: stats,
          timestamp: Date.now(),
        })
      );
    } catch (error) {
      socket.send(
        JSON.stringify({
          type: 'error',
          message: (error as Error).message,
          timestamp: Date.now(),
        })
      );
    }
  }

  // Broadcast to all connected clients
  function broadcast(message: any) {
    const data = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === 1) {
        // OPEN
        client.send(data);
      }
    }
  }

  // Export broadcast function for use elsewhere
  (fastify as any).broadcast = broadcast;
}
