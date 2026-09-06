/**
 * 🔮 Transcription Palantir - Request Logger Middleware
 *
 * HTTP request/response logging
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { recordResponse } from '../../services/request-stats.js';
import { logger } from '../../utils/logger.js';

// =============================================================================
// REQUEST LOGGER
// =============================================================================

export async function requestLogger(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const startTime = Date.now();

  // Attach start time to request for response time calculation
  (request as any).startTime = startTime;

  // Log incoming request
  logger.info(
    {
      requestId: request.id,
      method: request.method,
      url: request.url,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    },
    'Incoming request'
  );

  // Log response when finished
  reply.raw.on('finish', () => {
    const duration = Date.now() - startTime;

    logger.info(
      {
        requestId: request.id,
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        duration: `${duration}ms`,
      },
      'Request completed'
    );

    // Feed the rolling-window readiness signal. Guarded so a bug here can
    // never turn a successfully-served response into a broken one.
    try {
      recordResponse(reply.statusCode);
    } catch (err) {
      logger.warn({ err }, 'Failed to record response stats');
    }
  });
}
