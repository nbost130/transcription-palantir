/**
 * 🔮 Transcription Palantir - Request Logger Middleware
 *
 * HTTP request/response logging
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import { recordResponse } from '../../services/request-stats.js';
import { logger } from '../../utils/logger.js';

// =============================================================================
// PROBE EXCLUSION
// =============================================================================

/**
 * Health and readiness probes report on the service; they are not the
 * service. A 503 from /ready when requests are degraded must not feed back
 * into the very error rate it is reporting, or a monitor polling it would
 * keep the window degraded after real errors stop.
 */
export function isProbeUrl(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return /\/(health|ready)$/.test(path);
}

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
    if (!isProbeUrl(request.url)) {
      try {
        recordResponse(reply.statusCode);
      } catch (err) {
        logger.warn({ err }, 'Failed to record response stats');
      }
    }
  });
}
