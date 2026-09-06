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

export type RefreshOutcome = 'kept' | 'reacquired' | 'lost';

export interface ProcessGuardOptions {
  /**
   * Called when the lock is held by ANOTHER instance. Default: SIGTERM
   * ourselves so index.ts runs its graceful shutdown (under the hard
   * deadline in utils/shutdown-deadline.ts). Injectable for tests.
   */
  onLost?: () => void;
}

export class ProcessGuardService {
  private redis: Redis;
  private token: string;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private acquired = false;
  private readonly onLost: () => void;

  constructor(options: ProcessGuardOptions = {}) {
    this.redis = new IORedis(getRedisUrl(), {
      maxRetriesPerRequest: null,
      connectTimeout: appConfig.redis.connectTimeout,
    });
    this.token = `${process.pid}:${randomBytes(8).toString('hex')}`;
    this.onLost =
      options.onLost ??
      (() => {
        // A lost lock is a failure, not a clean stop: exit non-zero so
        // systemd (Restart=on-failure/always) brings a fresh instance up.
        process.exitCode = 1;
        process.kill(process.pid, 'SIGTERM');
      });
  }

  /** Our lock token. Tests use it to inspect the key. */
  get lockToken(): string {
    return this.token;
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

  /**
   * One heartbeat: refresh the TTL if we still own the lock.
   *
   * If the refresh finds the key gone or foreign, distinguish EXPIRED from
   * STOLEN before doing anything drastic. 2026-09-04: a machine-wide OOM
   * stall paused this process for longer than LOCK_TTL_MS; the key simply
   * expired with nobody else holding it, but the old code treated any
   * refresh miss as "stolen", SIGTERM'd itself, and the shutdown then hung
   * for two days with the API up and the file watcher dead. An expired lock
   * with no other holder is ours to take back (SET NX is atomic, so if two
   * instances race here exactly one wins and the other correctly reports
   * `lost`).
   */
  async refreshOnce(): Promise<RefreshOutcome> {
    const refreshed = (await this.redis.eval(REFRESH_SCRIPT, 1, LOCK_KEY, this.token, String(LOCK_TTL_MS))) as number;
    if (refreshed === 1) return 'kept';

    const reacquired = await this.redis.set(LOCK_KEY, this.token, 'PX', LOCK_TTL_MS, 'NX');
    if (reacquired === 'OK') {
      logger.warn(
        { token: this.token, ttlMs: LOCK_TTL_MS },
        '⚠️ Singleton lock had expired (heartbeat stalled longer than the TTL); re-acquired'
      );
      return 'reacquired';
    }

    const holder = await this.redis.get(LOCK_KEY);
    logger.error(
      { token: this.token, currentHolder: holder },
      '🚨 Singleton lock is held by another instance. Shutting down.'
    );
    return 'lost';
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    const tick = async (): Promise<void> => {
      try {
        const outcome = await this.refreshOnce();
        if (outcome === 'lost') {
          this.acquired = false;
          this.onLost();
          return; // do not reschedule
        }
      } catch (error) {
        // Redis unreachable: keep trying. The lock expires on its own if we
        // stay disconnected, and the next successful tick re-acquires it.
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
