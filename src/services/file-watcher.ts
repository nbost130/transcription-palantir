/**
 * 🔮 Transcription Palantir - File Watcher Service
 *
 * Monitors directories for new audio files and automatically creates transcription jobs
 */

import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import chokidar from 'chokidar';
import { appConfig } from '../config/index.js';
import { JobPriority, JobStatus, type TranscriptionJob } from '../types/index.js';
import { getMimeType } from '../utils/file.js';
import { logger } from '../utils/logger.js';
import { fileTracker } from './file-tracker.js';
import { transcriptionQueue } from './queue.js';

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
      // Connect file tracker
      await fileTracker.connect();

      // Verify watch directory exists and is accessible
      await this.verifyDirectory(appConfig.processing.watchDirectory);

      // Create watcher
      this.watcher = chokidar.watch(appConfig.processing.watchDirectory, {
        ignored: /(^|[/\\])\../, // Ignore dotfiles
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

      logger.info(
        {
          watchDirectory: appConfig.processing.watchDirectory,
          supportedFormats: appConfig.processing.supportedFormats,
        },
        '👁️ File watcher started successfully'
      );

      // Perform initial scan for existing files
      await this.performInitialScan();
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
      // 1. Sanitize filename first
      const sanitizedPath = await this.sanitizeFile(filePath);

      // If file was renamed, we stop here. 
      // The watcher will detect the "new" file (renamed version) and process it then.
      if (sanitizedPath !== filePath) {
        logger.info({ original: filePath, sanitized: sanitizedPath }, 'File renamed for sanitization');
        return;
      }

      // 2. Skip if already processed (check both in-memory and persistent storage)
      if (this.processedFiles.has(filePath)) {
        return;
      }

      // Check persistent storage for duplicate detection across restarts
      const alreadyProcessed = await fileTracker.isProcessed(filePath);
      if (alreadyProcessed) {
        logger.debug({ filePath }, 'File already processed (found in persistent storage), skipping');
        this.processedFiles.add(filePath); // Add to in-memory cache
        return;
      }

      logger.info({ filePath }, 'New file detected');

      // Validate file
      const validation = await this.validateFile(filePath);
      if (!validation.valid) {
        logger.warn(
          {
            filePath,
            reason: validation.reason,
          },
          'File validation failed, skipping'
        );
        return;
      }

      // Create transcription job
      if (validation.metadata) {
        await this.createJobForFile(filePath, validation.metadata);
      }

      // Mark as processed (both in-memory and persistent)
      this.processedFiles.add(filePath);
    } catch (error) {
      logger.error(
        {
          error,
          filePath,
        },
        'Error handling file'
      );
    }
  }

  // ===========================================================================
  // SANITIZATION
  // ===========================================================================

  private async sanitizeFile(filePath: string): Promise<string> {
    const dir = join(filePath, '..');
    const ext = extname(filePath);
    const name = basename(filePath, ext);

    // Replace spaces with underscores, remove unsafe chars
    const safeName = name
      .replace(/\s+/g, '_')           // Spaces to underscores
      .replace(/[^a-zA-Z0-9\-_\.]/g, '') // Remove non-alphanumeric (except -, _, and .)
      .replace(/_+/g, '_');           // Dedupe underscores

    const newFileName = `${safeName}${ext}`;
    const newFilePath = join(dir, newFileName);

    if (newFilePath !== filePath) {
      try {
        await import('fs/promises').then(fs => fs.rename(filePath, newFilePath));
        return newFilePath;
      } catch (error) {
        logger.error({ error, filePath, newFilePath }, 'Failed to rename file for sanitization');
        // If rename fails, return original path and try to process as is
        return filePath;
      }
    }

    return filePath;
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
        mimeType: getMimeType(extension),
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

  private async createJobForFile(filePath: string, metadata: FileMetadata): Promise<void> {
    try {
      // Generate deterministic job ID based on file content/metadata
      // This prevents duplicate jobs for the exact same file
      const jobId = this.generateJobId(filePath, metadata);

      const jobData: Partial<TranscriptionJob> = {
        id: jobId,
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

      try {
        const job = await transcriptionQueue.addJob(jobData);

        // Check if we got back an existing job (duplicate)
        // Note: BullMQ returns the job instance. If it was a duplicate, 
        // the timestamp might be older.
        // However, standard BullMQ behavior with jobId is to return the existing job.

        // Mark file as processed in persistent storage
        await fileTracker.markProcessed(filePath, jobId);

        logger.info(
          {
            jobId: job.id,
            fileName: metadata.fileName,
            fileSize: `${metadata.fileSizeMB.toFixed(2)}MB`,
            priority: metadata.priority,
          },
          '✅ Transcription job created (or existing job returned)'
        );
      } catch (error: any) {
        // Handle case where job might already exist but in a state that causes error
        logger.warn({ error, jobId }, 'Error adding job to queue (possible duplicate)');
        throw error;
      }
    } catch (error) {
      logger.error(
        {
          error,
          filePath,
          fileName: metadata.fileName,
        },
        'Failed to create transcription job'
      );
      throw error;
    }
  }

  private generateJobId(filePath: string, metadata: FileMetadata): string {
    const { createHash } = require('crypto');
    // Create a unique hash based on file path, size, and modification time
    // If any of these change, it's considered a new version of the file
    const input = `${filePath}:${metadata.fileSize}:${metadata.modifiedAt.getTime()}`;
    return createHash('md5').update(input).digest('hex');
  }

  // ===========================================================================
  // INITIAL SCAN
  // ===========================================================================

  private async performInitialScan(): Promise<void> {
    try {
      logger.info('🔍 Performing initial scan for existing files...');
      const foundFiles = await this.scanDirectoryRecursively(appConfig.processing.watchDirectory);

      if (foundFiles.length > 0) {
        logger.info({ count: foundFiles.length }, `Found ${foundFiles.length} existing audio files to process`);

        // Process each found file
        for (const filePath of foundFiles) {
          await this.handleFileAdded(filePath);
        }
      } else {
        logger.info('No existing audio files found in watch directory');
      }
    } catch (error) {
      logger.error({ error }, 'Error during initial scan');
    }
  }

  private async scanDirectoryRecursively(
    dirPath: string,
    maxDepth: number = 3,
    currentDepth: number = 0
  ): Promise<string[]> {
    const foundFiles: string[] = [];

    if (currentDepth >= maxDepth) {
      return foundFiles;
    }

    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Skip hidden directories
          if (entry.name.startsWith('.')) {
            continue;
          }

          // Recursively scan subdirectory
          const subFiles = await this.scanDirectoryRecursively(fullPath, maxDepth, currentDepth + 1);
          foundFiles.push(...subFiles);
        } else if (entry.isFile()) {
          // Check if it's a supported audio file
          const extension = extname(entry.name).toLowerCase().slice(1);
          if (appConfig.processing.supportedFormats.includes(extension)) {
            foundFiles.push(fullPath);
          }
        }
      }
    } catch (error) {
      logger.warn({ error, dirPath }, 'Error scanning directory');
    }

    return foundFiles;
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
      throw new Error(`Cannot access watch directory: ${dirPath} - ${(error as Error).message}`);
    }
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
