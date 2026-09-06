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
  let finished = false;
  reply.raw.on('finish', () => {
    finished = true;
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
      safeRecord(reply.statusCode);
    }
  });

  // A request that never finished (client aborted, or the server wedged)
  // would otherwise leave no sample at all, and a window with no samples
  // reads as healthy. Record it as 499 so a hung service degrades readiness.
  reply.raw.on('close', () => {
    if (!finished && !isProbeUrl(request.url)) {
      safeRecord(499);
    }
  });
}

function safeRecord(statusCode: number): void {
  try {
    recordResponse(statusCode);
  } catch (err) {
    logger.warn({ err }, 'Failed to record response stats');
  }
}
