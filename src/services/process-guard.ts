/**
 * 🔮 Transcription Palantir - Process Guard Service
 *
 * Redis-backed mutex. Only one Palantir instance runs at a time.
 *
 * Why not `ps aux | grep`: the old implementation was disabled because
 * during deploys the outgoing process and incoming process briefly
 * coexist, and grep-based detection produced false positives that
 * blocked startup. A TTL-refreshed Redis lock survives clean deploys
 * (outgoing process releases on shutdown; lock becomes acquirable
 * immediately) AND survives crashes (TTL expires; next start takes
 * over without a manual unstick).
 *
 * Protocol:
 *   acquire(): SET palantir:lock <token> NX PX <ttl>
 *     - success → we own the lock; spawn heartbeat
 *     - failure → another instance is alive (or lock TTL not yet expired)
 *   heartbeat: every TTL/3, refresh PEXPIRE if the value still matches our token
 *   release(): atomic delete (Lua) iff value matches our token
 */

import { randomBytes } from 'node:crypto';
import { Redis as IORedis, type Redis } from 'ioredis';
import { appConfig, getRedisUrl } from '../config/index.js';
import { logger } from '../utils/logger.js';

const LOCK_KEY = 'palantir:singleton-lock';
const LOCK_TTL_MS = 30_000;
const HEARTBEAT_MS = Math.floor(LOCK_TTL_MS / 3);

const REFRESH_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export class ProcessGuardService {
  private redis: Redis;
  private token: string;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private acquired = false;

  constructor() {
    this.redis = new IORedis(getRedisUrl(), {
      maxRetriesPerRequest: null,
      connectTimeout: appConfig.redis.connectTimeout,
    });
    this.token = `${process.pid}:${randomBytes(8).toString('hex')}`;
  }

  /**
   * Try to become THE Palantir instance. Returns true on success.
   *
   * Stale-lock recovery: SET ... NX PX TTL — if the previous owner died
   * without releasing, its lock expires after TTL_MS and the next caller
   * acquires it. No manual unstick required.
   */
  async acquire(): Promise<boolean> {
    try {
      const result = await this.redis.set(LOCK_KEY, this.token, 'PX', LOCK_TTL_MS, 'NX');
      if (result !== 'OK') {
        const holder = await this.redis.get(LOCK_KEY);
        logger.error(
          { lockKey: LOCK_KEY, currentHolder: holder, ourToken: this.token },
          '🚨 Another Palantir instance owns the singleton lock'
        );
        return false;
      }

      this.acquired = true;
      this.startHeartbeat();
      logger.info({ token: this.token, ttlMs: LOCK_TTL_MS }, '🔒 Singleton lock acquired');
      return true;
    } catch (error) {
      logger.error({ error }, 'Error acquiring singleton lock');
      // Fail closed: if Redis is down we cannot guarantee singleton, so refuse to start.
      // Redis down is a real infra problem and the whole queue depends on it anyway.
      return false;
    }
  }

  async release(): Promise<void> {
    // Clear the heartbeat first regardless of acquired state.
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Critical: even if we never acquired, the constructor opened a Redis
    // connection. The finally block must always run to close it; otherwise
    // a failed acquire() leaks a handle (stalls test runners; leaks fds
    // in long-running supervisors that retry startup).
    try {
      if (!this.acquired) return;
      const result = (await this.redis.eval(RELEASE_SCRIPT, 1, LOCK_KEY, this.token)) as number;
      if (result === 1) {
        logger.info({ token: this.token }, '🔓 Singleton lock released');
      } else {
        logger.warn({ token: this.token }, 'Singleton lock was not owned by us at release time (TTL likely expired)');
      }
    } catch (error) {
      logger.error({ error }, 'Error releasing singleton lock');
    } finally {
      this.acquired = false;
      try {
        await this.redis.quit();
      } catch {}
    }
  }

  /**
   * Back-compat shim for the legacy call site. Returns true if safe to
   * start (i.e., we acquired the lock).
   */
  async checkForExistingInstance(): Promise<boolean> {
    return this.acquire();
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    const tick = async (): Promise<void> => {
      try {
        const result = (await this.redis.eval(REFRESH_SCRIPT, 1, LOCK_KEY, this.token, String(LOCK_TTL_MS))) as number;
        if (result === 0) {
          logger.error(
            { token: this.token },
            '🚨 Singleton lock was lost (TTL expired or stolen). Process should exit.'
          );
          process.kill(process.pid, 'SIGTERM');
          return; // do not reschedule
        }
      } catch (error) {
        logger.error({ error }, 'Singleton heartbeat failed');
      }
      // Self-rescheduling: only schedule the NEXT heartbeat after this one
      // resolves. A slow Redis op delays the next tick but never stacks
      // concurrent evals on top of itself.
      if (this.acquired) {
        this.heartbeatTimer = setTimeout(tick, HEARTBEAT_MS);
        this.heartbeatTimer.unref?.();
      }
    };
    this.heartbeatTimer = setTimeout(tick, HEARTBEAT_MS);
    this.heartbeatTimer.unref?.();
  }
}

export const processGuard = new ProcessGuardService();
