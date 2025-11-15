/**
 * 🔮 Transcription Palantir - File Watcher Service
 *
 * Monitors directories for new audio files and automatically creates transcription jobs
 */

import chokidar from 'chokidar';
import { stat, access } from 'fs/promises';
import { constants } from 'fs';
import { basename, extname } from 'path';
import { logger } from '../utils/logger.js';
import { appConfig } from '../config/index.js';
import { transcriptionQueue } from './queue.js';
import { JobPriority, JobStatus, type TranscriptionJob } from '../types/index.js';
import { randomUUID } from 'crypto';

// =============================================================================
// FILE WATCHER SERVICE
// =============================================================================

export class FileWatcherService {
  private watcher: chokidar.FSWatcher | null = null;
  private isRunning = false;
  private processedFiles = new Set<string>();

  // ===========================================================================
  // SERVICE LIFECYCLE
  // ===========================================================================

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('File watcher is already running');
      return;
    }

    try {
      // Verify watch directory exists and is accessible
      await this.verifyDirectory(appConfig.processing.watchDirectory);

      // Create watcher
      this.watcher = chokidar.watch(appConfig.processing.watchDirectory, {
        ignored: /(^|[\/\\])\../, // Ignore dotfiles
        persistent: true,
        ignoreInitial: false, // Process existing files on startup
        awaitWriteFinish: {
          stabilityThreshold: 2000, // Wait for file to be stable for 2 seconds
          pollInterval: 100,
        },
        depth: 3, // Watch subdirectories up to 3 levels deep
      });

      // Setup event listeners
      this.setupEventListeners();

      this.isRunning = true;

      logger.info({
        watchDirectory: appConfig.processing.watchDirectory,
        supportedFormats: appConfig.processing.supportedFormats,
      }, '👁️ File watcher started successfully');

    } catch (error) {
      logger.error({ error }, 'Failed to start file watcher');
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      if (this.watcher) {
        await this.watcher.close();
        this.watcher = null;
      }

      this.isRunning = false;
      this.processedFiles.clear();

      logger.info('✅ File watcher stopped gracefully');
    } catch (error) {
      logger.error({ error }, 'Error stopping file watcher');
      throw error;
    }
  }

  // ===========================================================================
  // EVENT LISTENERS
  // ===========================================================================

  private setupEventListeners(): void {
    if (!this.watcher) return;

    // File added event
    this.watcher.on('add', async (filePath: string) => {
      await this.handleFileAdded(filePath);
    });

    // File changed event (optional: re-process if file is updated)
    this.watcher.on('change', async (filePath: string) => {
      logger.debug({ filePath }, 'File changed (ignoring)');
      // Optionally handle file changes
    });

    // File removed event
    this.watcher.on('unlink', async (filePath: string) => {
      logger.debug({ filePath }, 'File removed');
      this.processedFiles.delete(filePath);
    });

    // Error event
    this.watcher.on('error', (error: Error) => {
      logger.error({ error }, 'File watcher error');
    });

    // Ready event
    this.watcher.on('ready', () => {
      logger.info('File watcher ready and watching for changes');
    });
  }

  // ===========================================================================
  // FILE HANDLING
  // ===========================================================================

  private async handleFileAdded(filePath: string): Promise<void> {
    try {
      // Skip if already processed
      if (this.processedFiles.has(filePath)) {
        return;
      }

      logger.info({ filePath }, 'New file detected');

      // Validate file
      const validation = await this.validateFile(filePath);
      if (!validation.valid) {
        logger.warn({
          filePath,
          reason: validation.reason,
        }, 'File validation failed, skipping');
        return;
      }

      // Create transcription job
      if (validation.metadata) {
        await this.createJobForFile(filePath, validation.metadata);
      }

      // Mark as processed
      this.processedFiles.add(filePath);

    } catch (error) {
      logger.error({
        error,
        filePath,
      }, 'Error handling file');
    }
  }

  // ===========================================================================
  // FILE VALIDATION
  // ===========================================================================

  private async validateFile(filePath: string): Promise<{
    valid: boolean;
    reason?: string;
    metadata?: FileMetadata;
  }> {
    try {
      // Check file exists and is accessible
      await access(filePath, constants.R_OK);

      // Get file stats
      const stats = await stat(filePath);

      // Check if it's a file (not a directory)
      if (!stats.isFile()) {
        return { valid: false, reason: 'Not a regular file' };
      }

      // Get file extension
      const extension = extname(filePath).toLowerCase().slice(1);
      const fileName = basename(filePath);

      // Check if format is supported
      if (!appConfig.processing.supportedFormats.includes(extension)) {
        return {
          valid: false,
          reason: `Unsupported format: ${extension}`,
        };
      }

      // Get file size in MB
      const fileSizeMB = stats.size / (1024 * 1024);

      // Check file size constraints
      if (fileSizeMB < appConfig.processing.minFileSize) {
        return {
          valid: false,
          reason: `File too small: ${fileSizeMB.toFixed(2)}MB (min: ${appConfig.processing.minFileSize}MB)`,
        };
      }

      if (fileSizeMB > appConfig.processing.maxFileSize) {
        return {
          valid: false,
          reason: `File too large: ${fileSizeMB.toFixed(2)}MB (max: ${appConfig.processing.maxFileSize}MB)`,
        };
      }

      // Determine priority based on file size
      let priority = JobPriority.NORMAL;
      if (fileSizeMB < 10) {
        priority = JobPriority.URGENT; // Small files get high priority
      } else if (fileSizeMB < 50) {
        priority = JobPriority.HIGH;
      } else if (fileSizeMB > 100) {
        priority = JobPriority.LOW; // Large files get low priority
      }

      const metadata: FileMetadata = {
        fileName,
        extension,
        fileSizeMB,
        fileSize: stats.size,
        mimeType: this.getMimeType(extension),
        priority,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
      };

      return { valid: true, metadata };

    } catch (error) {
      return {
        valid: false,
        reason: `File access error: ${(error as Error).message}`,
      };
    }
  }

  // ===========================================================================
  // JOB CREATION
  // ===========================================================================

  private async createJobForFile(
    filePath: string,
    metadata: FileMetadata
  ): Promise<void> {
    try {
      const jobData: Partial<TranscriptionJob> = {
        id: randomUUID(),
        fileName: metadata.fileName,
        filePath,
        fileSize: metadata.fileSize,
        mimeType: metadata.mimeType,
        status: JobStatus.PENDING,
        priority: metadata.priority,
        progress: 0,
        createdAt: new Date(),
        attempts: 0,
        maxAttempts: appConfig.processing.maxAttempts,
        metadata: {
          originalPath: filePath,
          audioFormat: metadata.extension,
          whisperModel: appConfig.whisper.model,
          language: appConfig.whisper.language,
        },
      };

      const job = await transcriptionQueue.addJob(jobData);

      logger.info({
        jobId: job.id,
        fileName: metadata.fileName,
        fileSize: `${metadata.fileSizeMB.toFixed(2)}MB`,
        priority: metadata.priority,
      }, '✅ Transcription job created');

    } catch (error) {
      logger.error({
        error,
        filePath,
        fileName: metadata.fileName,
      }, 'Failed to create transcription job');
      throw error;
    }
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  private async verifyDirectory(dirPath: string): Promise<void> {
    try {
      await access(dirPath, constants.R_OK | constants.W_OK);
      const stats = await stat(dirPath);

      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${dirPath}`);
      }

      logger.debug({ dirPath }, 'Directory verified');
    } catch (error) {
      throw new Error(
        `Cannot access watch directory: ${dirPath} - ${(error as Error).message}`
      );
    }
  }

  private getMimeType(extension: string): string {
    const mimeTypes: Record<string, string> = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      m4a: 'audio/mp4',
      flac: 'audio/flac',
      ogg: 'audio/ogg',
      mp4: 'video/mp4',
      mov: 'video/quicktime',
    };

    return mimeTypes[extension] || 'application/octet-stream';
  }

  // ===========================================================================
  // GETTERS
  // ===========================================================================

  get running(): boolean {
    return this.isRunning;
  }

  get processedCount(): number {
    return this.processedFiles.size;
  }
}

// =============================================================================
// TYPES
// =============================================================================

interface FileMetadata {
  fileName: string;
  extension: string;
  fileSizeMB: number;
  fileSize: number;
  mimeType: string;
  priority: JobPriority;
  createdAt: Date;
  modifiedAt: Date;
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const fileWatcher = new FileWatcherService();

// =============================================================================
// STANDALONE EXECUTION
// =============================================================================

if (import.meta.main) {
  const watcher = new FileWatcherService();

  watcher.start().catch((error) => {
    logger.fatal({ error }, 'Failed to start file watcher');
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down file watcher...');
    await watcher.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down file watcher...');
    await watcher.stop();
    process.exit(0);
  });
}
