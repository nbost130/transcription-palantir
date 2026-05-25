/**
 * 🔮 Transcription Palantir - Persistent File Tracker Service
 *
 * Redis-backed tracking of processed files. Dedup is keyed on the SHA-256
 * hash of file CONTENTS, not on path+size+mtime — so a rename, a re-sync,
 * or a copy of the same audio is recognised as already-processed.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Redis as IORedis, type Redis } from 'ioredis';
import { appConfig, getRedisUrl } from '../config/index.js';
import { logger } from '../utils/logger.js';

const REDIS_KEY_PREFIX = 'palantir:processed:';
const REDIS_HASH_KEY = 'palantir:file-hashes';
const TTL_DAYS = 30;
const TTL_SECONDS = TTL_DAYS * 24 * 60 * 60;

/**
 * In-memory cache: streaming a SHA over a 10 MB file is ~30 ms. The same
 * file is hashed multiple times per lifecycle (isProcessed, markProcessed,
 * unmarkProcessed, getMetadata). Cache invalidates when size or mtime
 * changes — same triple, same bytes, every time.
 */
interface HashCacheEntry {
  size: number;
  mtimeMs: number;
  hash: string;
}
const HASH_CACHE = new Map<string, HashCacheEntry>();
const HASH_CACHE_MAX_ENTRIES = 10_000;

export class FileTrackerService {
  private redis: Redis;
  private isConnected = false;

  constructor() {
    this.redis = new IORedis(getRedisUrl(), {
      maxRetriesPerRequest: null,
      connectTimeout: appConfig.redis.connectTimeout,
      retryStrategy(times) {
        return Math.min(times * 50, 2000);
      },
    });
    this.setupEventListeners();
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;
    try {
      if (this.redis.status === 'ready' || this.redis.status === 'connect' || this.redis.status === 'connecting') {
        this.isConnected = true;
        logger.info('📝 File tracker using dedicated Redis connection');
      } else {
        throw new Error(`Redis connection not ready: ${this.redis.status}`);
      }
    } catch (error) {
      logger.error({ error }, 'Failed to initialize file tracker with Redis');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) return;
    try {
      await this.redis.quit();
      this.isConnected = false;
      logger.info('📝 File tracker released Redis connection');
    } catch (error) {
      logger.error({ error }, 'Error releasing file tracker Redis connection');
    }
  }

  /**
   * True if this file's CONTENT has been processed before, regardless of
   * its current path. Path-based lookup is kept as a fast positive cache
   * for the common "same file, same path" case; the authoritative check
   * is the content hash.
   */
  async isProcessed(filePath: string): Promise<boolean> {
    try {
      const pathKey = this.getPathKey(filePath);
      const pathExists = await this.redis.exists(pathKey);
      if (pathExists) return true;

      const fileHash = await this.getContentHash(filePath);
      const hashExists = await this.redis.hexists(REDIS_HASH_KEY, fileHash);
      return hashExists === 1;
    } catch (error) {
      logger.error({ error, filePath }, 'Error checking if file is processed');
      return false;
    }
  }

  async markProcessed(filePath: string, jobId: string): Promise<void> {
    try {
      const fileHash = await this.getContentHash(filePath);
      const metadata = JSON.stringify({
        filePath,
        jobId,
        processedAt: new Date().toISOString(),
        fileHash,
      });

      const pathKey = this.getPathKey(filePath);
      await this.redis.setex(pathKey, TTL_SECONDS, metadata);
      await this.redis.hset(REDIS_HASH_KEY, fileHash, metadata);

      logger.debug({ filePath, jobId, fileHash }, 'Marked file as processed');
    } catch (error) {
      logger.error({ error, filePath, jobId }, 'Error marking file as processed');
    }
  }

  async unmarkProcessed(filePath: string): Promise<void> {
    // Always clear the path key first — independent of whether the file
    // still exists on disk. The content-hash deletion is best-effort:
    // if the file was deleted between markProcessed and now, streaming the
    // SHA throws; we must not let that leave the path key locked for 30 days.
    try {
      const pathKey = this.getPathKey(filePath);
      await this.redis.del(pathKey);

      try {
        const fileHash = await this.getContentHash(filePath);
        await this.redis.hdel(REDIS_HASH_KEY, fileHash);
        logger.debug({ filePath, fileHash }, 'Unmarked file as processed (path + hash)');
      } catch (hashError) {
        logger.debug({ filePath }, 'Unmarked path key; file unavailable to compute hash for content-key deletion');
      }
    } catch (error) {
      logger.error({ error, filePath }, 'Error unmarking file as processed');
    }
  }

  async getMetadata(filePath: string): Promise<ProcessedFileMetadata | null> {
    try {
      const pathKey = this.getPathKey(filePath);
      const data = await this.redis.get(pathKey);
      if (data) return JSON.parse(data);

      const fileHash = await this.getContentHash(filePath);
      const hashData = await this.redis.hget(REDIS_HASH_KEY, fileHash);
      return hashData ? JSON.parse(hashData) : null;
    } catch (error) {
      logger.error({ error, filePath }, 'Error getting file metadata');
      return null;
    }
  }

  /**
   * Public, intentionally exposed so callers (intake, audit tools)
   * can compute the canonical content hash for any file path.
   * Streams the file through SHA-256 — works on arbitrarily large files.
   */
  async getContentHash(filePath: string): Promise<string> {
    const stats = await stat(filePath);
    const cached = HASH_CACHE.get(filePath);
    if (cached && cached.size === stats.size && cached.mtimeMs === stats.mtimeMs) {
      return cached.hash;
    }

    const hash = await this.streamSha256(filePath);

    if (HASH_CACHE.size >= HASH_CACHE_MAX_ENTRIES) {
      const firstKey = HASH_CACHE.keys().next().value;
      if (firstKey !== undefined) HASH_CACHE.delete(firstKey);
    }
    HASH_CACHE.set(filePath, { size: stats.size, mtimeMs: stats.mtimeMs, hash });

    return hash;
  }

  private streamSha256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hasher = createHash('sha256');
      const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 });
      stream.on('data', (chunk) => hasher.update(chunk));
      stream.on('end', () => resolve(hasher.digest('hex')));
      stream.on('error', reject);
    });
  }

  private getPathKey(filePath: string): string {
    return `${REDIS_KEY_PREFIX}${filePath}`;
  }

  private setupEventListeners(): void {
    this.redis.on('error', (error) => {
      logger.error({ error }, 'File tracker Redis error');
    });
    this.redis.on('connect', () => logger.debug('File tracker Redis connected'));
    this.redis.on('ready', () => logger.debug('File tracker Redis ready'));
  }
}

interface ProcessedFileMetadata {
  filePath: string;
  jobId: string;
  processedAt: string;
  fileHash: string;
}

export const fileTracker = new FileTrackerService();
