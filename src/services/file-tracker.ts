/**
 * 🔮 Transcription Palantir - Persistent File Tracker Service
 *
 * Redis-backed tracking of processed files to prevent duplicate job creation
 * across service restarts and ensure idempotent file processing.
 */

import { createHash } from 'crypto';
import { stat } from 'fs/promises';
import type { Redis } from 'ioredis';
import { logger } from '../utils/logger.js';
import { redisConnection } from './queue.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const REDIS_KEY_PREFIX = 'palantir:processed:';
const REDIS_HASH_KEY = 'palantir:file-hashes';
const TTL_DAYS = 30; // Keep processed file records for 30 days
const TTL_SECONDS = TTL_DAYS * 24 * 60 * 60;

// =============================================================================
// FILE TRACKER SERVICE
// =============================================================================

export class FileTrackerService {
  private redis: Redis;
  private isConnected = false;

  constructor() {
    // Reuse the existing Redis connection from queue service
    this.redis = redisConnection;
    this.setupEventListeners();
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      // Redis connection is already established by queue service
      // Just verify it's ready
      if (this.redis.status === 'ready' || this.redis.status === 'connect' || this.redis.status === 'connecting') {
        this.isConnected = true;
        logger.info('📝 File tracker using shared Redis connection');
      } else {
        throw new Error(`Redis connection not ready: ${this.redis.status}`);
      }
    } catch (error) {
      logger.error({ error }, 'Failed to initialize file tracker with Redis');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) {
      return;
    }

    try {
      // Don't disconnect the shared Redis connection - it's managed by queue service
      this.isConnected = false;
      logger.info('📝 File tracker released Redis connection');
    } catch (error) {
      logger.error({ error }, 'Error releasing file tracker Redis connection');
    }
  }

  // ===========================================================================
  // FILE TRACKING
  // ===========================================================================

  /**
   * Check if a file has been processed
   * Uses both file path and content hash for robust duplicate detection
   */
  async isProcessed(filePath: string): Promise<boolean> {
    try {
      // Check by file path
      const pathKey = this.getPathKey(filePath);
      const pathExists = await this.redis.exists(pathKey);

      if (pathExists) {
        return true;
      }

      // Check by content hash (catches renamed/moved files)
      const fileHash = await this.getFileHash(filePath);
      const hashExists = await this.redis.hexists(REDIS_HASH_KEY, fileHash);

      return hashExists === 1;
    } catch (error) {
      logger.error({ error, filePath }, 'Error checking if file is processed');
      // Fail open - allow processing if we can't check
      return false;
    }
  }

  /**
   * Mark a file as processed
   * Stores both file path and content hash for comprehensive tracking
   */
  async markProcessed(filePath: string, jobId: string): Promise<void> {
    try {
      const fileHash = await this.getFileHash(filePath);
      const timestamp = new Date().toISOString();
      const metadata = JSON.stringify({
        filePath,
        jobId,
        processedAt: timestamp,
        fileHash,
      });

      // Store by file path with TTL
      const pathKey = this.getPathKey(filePath);
      await this.redis.setex(pathKey, TTL_SECONDS, metadata);

      // Store by content hash (no TTL - permanent deduplication)
      await this.redis.hset(REDIS_HASH_KEY, fileHash, metadata);

      logger.debug({ filePath, jobId, fileHash }, 'Marked file as processed');
    } catch (error) {
      logger.error({ error, filePath, jobId }, 'Error marking file as processed');
      // Don't throw - this is not critical enough to fail the job
    }
  }

  /**
   * Remove a file from processed tracking
   * Used when a job fails and needs to be retried
   */
  async unmarkProcessed(filePath: string): Promise<void> {
    try {
      const fileHash = await this.getFileHash(filePath);

      // Remove by file path
      const pathKey = this.getPathKey(filePath);
      await this.redis.del(pathKey);

      // Remove by content hash
      await this.redis.hdel(REDIS_HASH_KEY, fileHash);

      logger.debug({ filePath, fileHash }, 'Unmarked file as processed');
    } catch (error) {
      logger.error({ error, filePath }, 'Error unmarking file as processed');
    }
  }

  /**
   * Get processing metadata for a file
   */
  async getMetadata(filePath: string): Promise<ProcessedFileMetadata | null> {
    try {
      const pathKey = this.getPathKey(filePath);
      const data = await this.redis.get(pathKey);

      if (data) {
        return JSON.parse(data);
      }

      // Try by content hash
      const fileHash = await this.getFileHash(filePath);
      const hashData = await this.redis.hget(REDIS_HASH_KEY, fileHash);

      if (hashData) {
        return JSON.parse(hashData);
      }

      return null;
    } catch (error) {
      logger.error({ error, filePath }, 'Error getting file metadata');
      return null;
    }
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  private getPathKey(filePath: string): string {
    return `${REDIS_KEY_PREFIX}${filePath}`;
  }

  private async getFileHash(filePath: string): Promise<string> {
    try {
      const stats = await stat(filePath);
      // Hash based on file path, size, and mtime for efficient duplicate detection
      const hashInput = `${filePath}:${stats.size}:${stats.mtimeMs}`;
      return createHash('sha256').update(hashInput).digest('hex');
    } catch (error) {
      // If we can't stat the file, just hash the path
      return createHash('sha256').update(filePath).digest('hex');
    }
  }

  private setupEventListeners(): void {
    this.redis.on('error', (error) => {
      logger.error({ error }, 'File tracker Redis error');
    });

    this.redis.on('connect', () => {
      logger.debug('File tracker Redis connected');
    });

    this.redis.on('ready', () => {
      logger.debug('File tracker Redis ready');
    });
  }
}

// =============================================================================
// TYPES
// =============================================================================

interface ProcessedFileMetadata {
  filePath: string;
  jobId: string;
  processedAt: string;
  fileHash: string;
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const fileTracker = new FileTrackerService();
