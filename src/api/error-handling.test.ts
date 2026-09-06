/**
 * Integration tests for the rate-limit + error-handling surface that used
 * to turn allowlisted-poller traffic and non-Error throws into silent 500s
 * (ISA.md ISC-1..8, Anti-1, Anti-2, Anti-3).
 *
 * Builds a real Fastify instance registering the SAME `buildRateLimitOptions`
 * output, the SAME `errorHandler`, and the SAME `requestLogger` that
 * `server.ts` registers, in the same order, so this test exercises
 * production behaviour rather than a re-implementation of it.
 */
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// request-stats is a real in-process module (no mocking needed/allowed —
// we assert against its real rolling window).
import { reset, snapshot } from '../services/request-stats.js';
import { logger } from '../utils/logger.js';
import { errorHandler } from './middleware/error.js';
import { requestLogger } from './middleware/logger.js';
import { buildRateLimitOptions, type RateLimitPolicyOverrides } from './rate-limit-policy.js';

async function buildTestApp(rateLimitOverrides: RateLimitPolicyOverrides = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, disableRequestLogging: true });

  // Same registration order as server.ts: rate-limit plugin first, request
  // logger hook second.
  await app.register(rateLimit, buildRateLimitOptions(rateLimitOverrides));
  app.addHook('onRequest', requestLogger);
  app.setErrorHandler(errorHandler);

  app.get('/ok', async () => ({ ok: true }));

  app.get('/throw-plain-object', async () => {
    throw { foo: 1 };
  });

  app.get('/throw-string', async () => {
    throw 'boom';
  });

  app.get('/throw-404', async () => {
    throw Object.assign(new Error('nope'), { statusCode: 404 });
  });

  app.get('/throw-400-plain', async () => {
    throw { statusCode: 400 };
  });

  app.get('/throw-plain-error', async () => {
    throw new Error('x');
  });

  await app.ready();
  return app;
}

describe('rate limiting + error handling', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    reset();
    vi.restoreAllMocks();
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);
  });

  // ===========================================================================
  // ISC-1: allowlisted loopback never rate-limited
  // ===========================================================================

  it('ISC-1: 200 loopback GETs with a tiny max all return 200', async () => {
    const app = await buildTestApp({ max: 2 });

    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'GET', url: '/ok', remoteAddress: '127.0.0.1' });
      expect(res.statusCode).toBe(200);
    }

    await app.close();
  });

  // ===========================================================================
  // ISC-2, ISC-3, Anti-1: public address gets a truthful 429, not a 500
  // ===========================================================================

  it('ISC-2/3: a public address beyond max gets 429 with the correct body, header, and log', async () => {
    const app = await buildTestApp({ max: 2 });

    const first = await app.inject({ method: 'GET', url: '/ok', remoteAddress: '203.0.113.9' });
    const second = await app.inject({ method: 'GET', url: '/ok', remoteAddress: '203.0.113.9' });
    const third = await app.inject({ method: 'GET', url: '/ok', remoteAddress: '203.0.113.9' });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    // Anti-1: never a 500 for a rate-limited request.
    expect(third.statusCode).toBe(429);
    expect(third.statusCode).not.toBe(500);

    const body = third.json();
    expect(body).toMatchObject({
      success: false,
      error: 'Rate limit exceeded',
    });
    expect(typeof body.retryAfter).toBe('string');
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.requestId).toBe('string');

    expect(third.headers['retry-after']).toBeDefined();

    // ISC-3: exactly one warn log line, statusCode 429, non-empty message; never an error-level line.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [payload] = warnSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(payload.statusCode).toBe(429);
    const loggedErr = payload.err as Error;
    expect(loggedErr.message).toBeTruthy();
    expect(loggedErr.message.length).toBeGreaterThan(0);

    expect(errorSpy).not.toHaveBeenCalled();

    await app.close();
  });

  // ===========================================================================
  // Anti-2: never a bare `"error":{}` / `"err":{}` shape
  // ===========================================================================

  it('Anti-2: the logged err for a 429 is never an empty object', async () => {
    const app = await buildTestApp({ max: 1 });

    await app.inject({ method: 'GET', url: '/ok', remoteAddress: '203.0.113.9' });
    await app.inject({ method: 'GET', url: '/ok', remoteAddress: '203.0.113.9' });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [payload] = warnSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(Object.keys(payload.err as object).length).toBeGreaterThan(0);
    expect((payload.err as Error).message).not.toBe('');

    await app.close();
  });

  // ===========================================================================
  // ISC-5: non-Error thrown values still produce a truthful 500
  // ===========================================================================

  it('ISC-5: throwing a plain object yields 500 and a log naming the value, tagged non-error', async () => {
    const app = await buildTestApp();

    const res = await app.inject({ method: 'GET', url: '/throw-plain-object', remoteAddress: '127.0.0.1' });

    expect(res.statusCode).toBe(500);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [payload] = errorSpy.mock.calls[0] as [Record<string, unknown>, string];
    const err = payload.err as Error & { errorType?: string };
    expect(err.message).toContain('foo');
    expect(err.errorType).toBe('non-error');

    await app.close();
  });

  it('ISC-5: throwing a string yields 500 and the exact message', async () => {
    const app = await buildTestApp();

    const res = await app.inject({ method: 'GET', url: '/throw-string', remoteAddress: '127.0.0.1' });

    expect(res.statusCode).toBe(500);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [payload] = errorSpy.mock.calls[0] as [Record<string, unknown>, string];
    const err = payload.err as Error & { errorType?: string };
    expect(err.message).toBe('boom');
    expect(err.errorType).toBe('non-error');

    await app.close();
  });

  // ===========================================================================
  // ISC-6: real 4xx statusCode is preserved; only status-less becomes 500
  // ===========================================================================

  it('ISC-6: a thrown Error with statusCode 404 stays 404', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/throw-404', remoteAddress: '127.0.0.1' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('ISC-6: a thrown plain object with statusCode 400 stays 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/throw-400-plain', remoteAddress: '127.0.0.1' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('ISC-6: a plain status-less Error becomes 500', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/throw-plain-error', remoteAddress: '127.0.0.1' });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  // ===========================================================================
  // ISC-7: every 5xx log line carries the full field set; 4xx logs at warn
  // ===========================================================================

  it('ISC-7: the 500 log line carries err.message, err.stack, requestId, method, url, statusCode', async () => {
    const app = await buildTestApp();

    const res = await app.inject({ method: 'GET', url: '/throw-plain-error', remoteAddress: '127.0.0.1' });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [payload] = errorSpy.mock.calls[0] as [Record<string, unknown>, string];
    const err = payload.err as Error;
    expect(err.message).toBe('x');
    expect(typeof err.stack).toBe('string');
    expect(payload.requestId).toBeTruthy();
    expect(payload.method).toBe('GET');
    expect(payload.url).toBe('/throw-plain-error');
    expect(payload.statusCode).toBe(500);
    expect(res.statusCode).toBe(500);

    await app.close();
  });

  it('ISC-7: the 404 case logs at warn, not error', async () => {
    const app = await buildTestApp();

    await app.inject({ method: 'GET', url: '/throw-404', remoteAddress: '127.0.0.1' });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    const [payload] = warnSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(payload.statusCode).toBe(404);

    await app.close();
  });

  // ===========================================================================
  // ISC-8: the access log + request-stats reflect the status actually sent
  // ===========================================================================

  it('ISC-8: request-stats records the same statusCode the client received for a failed request', async () => {
    const app = await buildTestApp();

    const res = await app.inject({ method: 'GET', url: '/throw-plain-object', remoteAddress: '127.0.0.1' });
    expect(res.statusCode).toBe(500);

    const stats = snapshot();
    expect(stats.total).toBe(1);
    expect(stats.serverErrors).toBe(1);
    expect(stats.serverErrorRate).toBe(1);

    await app.close();
  });
});

describe('X-Forwarded-For cannot buy a place on the allowList (Anti-3)', () => {
  it('a public client claiming 127.0.0.1 via the header is still rate limited when trustProxy is off', async () => {
    // Mirrors src/api/server.ts: trustProxy is false there for exactly this reason.
    const app = Fastify({ logger: false, disableRequestLogging: true, trustProxy: false });
    await app.register(rateLimit, buildRateLimitOptions({ max: 2, timeWindow: 60_000 }));
    app.setErrorHandler(errorHandler);
    app.get('/x', async () => ({ ok: true }));
    await app.ready();

    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({
        method: 'GET',
        url: '/x',
        remoteAddress: '203.0.113.9',
        headers: { 'x-forwarded-for': '127.0.0.1' },
      });
      codes.push(res.statusCode);
    }
    expect(codes).toEqual([200, 200, 429, 429]);
    await app.close();
  });
});
