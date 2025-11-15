/**
 * 🔮 Transcription Palantir - Error Handler Middleware
 *
 * Centralized error handling for API requests
 */

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { logger } from '../../utils/logger.js';
import { ZodError } from 'zod';

// =============================================================================
// ERROR HANDLER
// =============================================================================

export async function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const requestId = request.id;

  // Log the error
  logger.error({
    error: {
      message: error.message,
      stack: error.stack,
      code: error.code,
      statusCode: error.statusCode,
    },
    requestId,
    method: request.method,
    url: request.url,
  }, 'Request error');

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    reply.status(400).send({
      success: false,
      error: 'Validation error',
      details: error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      })),
      timestamp: new Date().toISOString(),
      requestId,
    });
    return;
  }

  // Handle Fastify validation errors
  if (error.validation) {
    reply.status(400).send({
      success: false,
      error: 'Validation error',
      details: error.validation,
      timestamp: new Date().toISOString(),
      requestId,
    });
    return;
  }

  // Handle rate limit errors
  if (error.statusCode === 429) {
    reply.status(429).send({
      success: false,
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.',
      timestamp: new Date().toISOString(),
      requestId,
    });
    return;
  }

  // Handle not found errors
  if (error.statusCode === 404) {
    reply.status(404).send({
      success: false,
      error: 'Not found',
      message: error.message || 'Resource not found',
      timestamp: new Date().toISOString(),
      requestId,
    });
    return;
  }

  // Handle unauthorized errors
  if (error.statusCode === 401) {
    reply.status(401).send({
      success: false,
      error: 'Unauthorized',
      message: 'Authentication required',
      timestamp: new Date().toISOString(),
      requestId,
    });
    return;
  }

  // Handle forbidden errors
  if (error.statusCode === 403) {
    reply.status(403).send({
      success: false,
      error: 'Forbidden',
      message: 'Access denied',
      timestamp: new Date().toISOString(),
      requestId,
    });
    return;
  }

  // Default error response
  const statusCode = error.statusCode || 500;
  const message = statusCode === 500
    ? 'Internal server error'
    : error.message || 'An error occurred';

  reply.status(statusCode).send({
    success: false,
    error: message,
    timestamp: new Date().toISOString(),
    requestId,
    ...(process.env.NODE_ENV === 'development' && {
      stack: error.stack,
      details: error,
    }),
  });
}
