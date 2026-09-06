/**
 * 🔮 Transcription Palantir - Error Handler Middleware
 *
 * Centralized error handling for API requests.
 *
 * Root cause this exists to fix: the rate-limit plugin's errorResponseBuilder
 * used to return a plain object with no `statusCode`/`message`. This handler
 * read `error.message/stack/code/statusCode` (all `undefined`), logged
 * `"error":{}`, and fell through to `error.statusCode || 500` — turning
 * every rate-limited request into a 500 with an empty error log. See
 * ISA.md ISC-2..8, Anti-1, Anti-2.
 */

import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { logger } from '../../utils/logger.js';

// =============================================================================
// NORMALIZATION
// =============================================================================

/**
 * Non-Error thrown values are tagged with `errorType: 'non-error'` on the
 * wrapped Error (field name deliberately NOT `type` — pino's std `err`
 * serializer always overwrites `.type` with the constructor name, so a
 * literal `type` property would be silently clobbered before it ever
 * reaches the log line).
 */
export const NON_ERROR_TAG_VALUE = 'non-error';

type NormalizedError = FastifyError & {
  errorType?: string;
  cause?: unknown;
};

function summarize(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    const json = JSON.stringify(value);
    if (typeof json === 'string') return json;
  } catch {
    // fall through to String()
  }
  return String(value);
}

/**
 * Normalizes any thrown value into a real `Error`. Fastify (and plugins like
 * @fastify/rate-limit's errorResponseBuilder) can `throw` anything — a
 * string, a plain object, or a proper `Error`. Only a real `Error` instance
 * carries a usable `message`/`stack` for pino's `err` serializer, so
 * anything else is wrapped, tagged as `errorType: 'non-error'` (pino's own
 * serializer overwrites a literal `.type`, hence the distinct field name),
 * and the original value is preserved on `.cause`. `statusCode`/`code`
 * carried by a non-Error object (e.g. `{ statusCode: 400 }`) survive onto
 * the wrapped Error so status resolution still works.
 */
export function toError(value: unknown): NormalizedError {
  if (value instanceof Error) {
    return value as NormalizedError;
  }

  const err = new Error(summarize(value)) as NormalizedError;
  err.errorType = NON_ERROR_TAG_VALUE;
  err.cause = value;

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.statusCode === 'number') {
      err.statusCode = obj.statusCode;
    }
    if (obj.code !== undefined) {
      err.code = obj.code as string;
    }
  }

  return err;
}

/** Only a genuine 4xx/5xx status survives; anything else (including none) becomes 500. */
function resolveStatusCode(err: NormalizedError): number {
  const statusCode = err.statusCode;
  if (typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 600) {
    return statusCode;
  }
  return 500;
}

// =============================================================================
// ERROR HANDLER
// =============================================================================

export async function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const requestId = request.id;
  const timestamp = new Date().toISOString();

  let statusCode: number;
  let body: Record<string, unknown>;
  let err: NormalizedError;

  if (error instanceof ZodError) {
    err = error as unknown as NormalizedError;
    statusCode = 400;
    body = {
      success: false,
      error: 'Validation error',
      details: error.errors.map((fieldError) => ({
        field: fieldError.path.join('.'),
        message: fieldError.message,
      })),
      timestamp,
      requestId,
    };
  } else {
    err = toError(error);

    if (Array.isArray(err.validation) && err.validation.length > 0) {
      statusCode = 400;
      body = {
        success: false,
        error: 'Validation error',
        details: err.validation,
        timestamp,
        requestId,
      };
    } else {
      statusCode = resolveStatusCode(err);
      const message = statusCode === 500 ? 'Internal server error' : err.message || 'An error occurred';

      body = {
        success: false,
        error: message,
        timestamp,
        requestId,
      };

      // Carry through any extra client-facing field the thrower attached
      // (e.g. the rate limiter's `retryAfter`), without hardcoding a
      // rate-limit-specific branch here.
      const retryAfter = (err as unknown as Record<string, unknown>).retryAfter;
      if (typeof retryAfter !== 'undefined') {
        body.retryAfter = retryAfter;
      }
    }
  }

  const logPayload = {
    err,
    requestId,
    method: request.method,
    url: request.url,
    statusCode,
  };

  if (statusCode >= 500) {
    logger.error(logPayload, 'Request error');
  } else {
    logger.warn(logPayload, 'Request error');
  }

  reply.status(statusCode).send(body);
}
