/**
 * 🔮 Transcription Palantir - Rate Limit Policy
 *
 * Canonical home for "who is trusted enough to skip the rate limiter" and
 * for the exact options passed to @fastify/rate-limit. `server.ts` and
 * `error-handling.test.ts` both import this module so the registered
 * behaviour and the tested behaviour can never drift apart.
 *
 * Root cause this exists to fix: the rate limiter had no allowList, so a
 * trusted loopback poller calling every 5s got rate-limited, and the
 * plugin's errorResponseBuilder returned a plain object with no
 * `statusCode`/`message`, which the error handler logged as `"error":{}`
 * and turned into a 500. See ISA.md ISC-1..4, Anti-1, Anti-3.
 */

import type { errorResponseBuilderContext, RateLimitPluginOptions } from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';
import { appConfig } from '../config/index.js';

// =============================================================================
// TRUSTED ADDRESS CLASSIFICATION
// =============================================================================

/** Parses a dotted-quad IPv4 string into its four octets, or null if invalid. */
function parseIPv4Octets(address: string): [number, number, number, number] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    octets.push(value);
  }

  return octets as [number, number, number, number];
}

function isLoopbackV4([a]: [number, number, number, number]): boolean {
  return a === 127;
}

/** RFC1918 private ranges: 10/8, 172.16/12, 192.168/16. */
function isRfc1918([a, b]: [number, number, number, number]): boolean {
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/** CGNAT / Tailscale range: 100.64.0.0/10 (100.64.x.x - 100.127.x.x). */
function isCgnat([a, b]: [number, number, number, number]): boolean {
  return a === 100 && b >= 64 && b <= 127;
}

/** IPv6 Unique Local Address block fc00::/7 — first hextet in [0xfc00, 0xfdff]. */
function isIpv6UniqueLocal(address: string): boolean {
  const firstGroup = address.split(':')[0] ?? '';
  if (firstGroup.length === 0 || firstGroup.length > 4) return false;
  if (!/^[0-9a-f]+$/i.test(firstGroup)) return false;

  const value = Number.parseInt(firstGroup, 16);
  return value >= 0xfc00 && value <= 0xfdff;
}

/**
 * True for loopback, RFC1918 private, CGNAT (Tailscale), and IPv6 ULA
 * addresses — i.e. every address class a local poller or tailnet peer can
 * legitimately present. False for public addresses and malformed input.
 * Hand-parsed; no new dependency, never throws.
 */
export function isTrustedAddress(ip: string): boolean {
  if (typeof ip !== 'string' || ip.trim().length === 0) return false;

  let address = ip.trim();

  // IPv4-mapped IPv6 (::ffff:127.0.0.1) — evaluate the embedded IPv4 address.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(address);
  if (mapped?.[1]) {
    address = mapped[1];
  }

  if (address === '::1') return true;

  const octets = parseIPv4Octets(address);
  if (octets) {
    return isLoopbackV4(octets) || isRfc1918(octets) || isCgnat(octets);
  }

  if (address.includes(':')) {
    return isIpv6UniqueLocal(address);
  }

  return false;
}

// =============================================================================
// RATE LIMIT ERROR SHAPE
// =============================================================================

/**
 * The real shape @fastify/rate-limit builds at throw time (verified against
 * `node_modules/@fastify/rate-limit/index.js`): `{ statusCode, ban, max,
 * ttl, after }`. The published `errorResponseBuilderContext` type omits
 * `statusCode`, so it is asserted onto the (correctly-typed) context here
 * rather than widening the public callback signature.
 */
type RuntimeErrorResponseBuilderContext = errorResponseBuilderContext & { statusCode: number };

/** The object thrown by our `errorResponseBuilder` and normalised by `errorHandler`. */
export interface RateLimitErrorShape {
  success: false;
  error: string;
  retryAfter: string;
  timestamp: string;
  requestId: string;
  statusCode: number;
}

// =============================================================================
// OPTIONS BUILDER
// =============================================================================

export interface RateLimitPolicyOverrides {
  max?: number;
  timeWindow?: number | string;
}

/**
 * Builds the exact options passed to `fastify.register(rateLimit, ...)`.
 * `server.ts` calls this with no overrides (uses `appConfig.api`); tests
 * call it with a small `max` to exercise the 429 path deterministically.
 */
export function buildRateLimitOptions(overrides: RateLimitPolicyOverrides = {}): RateLimitPluginOptions {
  return {
    max: overrides.max ?? appConfig.api.rateLimitMax,
    timeWindow: overrides.timeWindow ?? appConfig.api.rateLimitWindow,
    allowList: (req: FastifyRequest) => isTrustedAddress(req.ip),
    errorResponseBuilder: (req, context) => {
      const { statusCode, after } = context as RuntimeErrorResponseBuilderContext;

      const err = new Error('Rate limit exceeded') as Error & RateLimitErrorShape;
      err.success = false;
      err.error = 'Rate limit exceeded';
      err.retryAfter = after;
      err.timestamp = new Date().toISOString();
      err.requestId = String(req.id);
      err.statusCode = statusCode;

      return err;
    },
  };
}
