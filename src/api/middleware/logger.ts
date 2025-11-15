/**
 * 🔮 Transcription Palantir - Request Logger Middleware
 *
 * HTTP request/response logging
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../../utils/logger.js';

// =============================================================================
// REQUEST LOGGER
// =============================================================================

export async function requestLogger(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const startTime = Date.now();

  // Log incoming request
  logger.info({
    requestId: request.id,
    method: request.method,
    url: request.url,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  }, 'Incoming request');

  // Log response when finished
  reply.raw.on('finish', () => {
    const duration = Date.now() - startTime;

    logger.info({
      requestId: request.id,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      duration: `${duration}ms`,
    }, 'Request completed');
  });
}
