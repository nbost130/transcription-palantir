/**
 * 🔮 Transcription Palantir - Transcription Worker
 *
 * BullMQ worker for processing transcription jobs with Whisper.cpp
 */

import { type Job, Worker } from 'bullmq';
import { spawn } from 'child_process';
import { constants } from 'fs';
import { access, copyFile, mkdir, rename, writeFile } from 'fs/promises';
import { Redis } from 'ioredis';
import { basename, dirname, extname, join } from 'path';
import { appConfig, getRedisUrl, getWhisperCommand } from '../config/index.js';
import { fasterWhisperService } from '../services/faster-whisper.js';
import { fileTracker } from '../services/file-tracker.js';
import { whisperService } from '../services/whisper.js';
import type { TranscriptionJob } from '../types/index.js';
import { logger } from '../utils/logger.js';

// =============================================================================
// REDIS CONNECTION
// =============================================================================

const redisConnection = new Redis(getRedisUrl(), {
  maxRetriesPerRequest: null, // Required for BullMQ
  lazyConnect: false, // Connect immediately
});

// =============================================================================
// TRANSCRIPTION WORKER
// =============================================================================

export class TranscriptionWorker {
  private worker: Worker | null = null;
  private isRunning = false;
  private processedJobs = 0;
  private failedJobs = 0;

  // ===========================================================================
  // WORKER LIFECYCLE
  // ===========================================================================

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Transcription worker is already running');
      return;
    }

    try {
      // Redis connection is handled automatically by BullMQ
      logger.info('🔵 DEBUG: About to create Worker instance');
      logger.info(
        { queueName: 'transcription', concurrency: appConfig.processing.maxWorkers },
        '🔵 DEBUG: Worker config'
      );

      this.worker = new Worker(
        'transcription',
        async (job: Job) => {
          logger.info({ jobId: job.id }, '🔵 DEBUG: PROCESSOR CALLBACK INVOKED!!!');
          return await this.processJob(job);
        },
        {
          connection: redisConnection,
          concurrency: appConfig.processing.maxWorkers,
          limiter: {
            max: appConfig.processing.maxWorkers,
            duration: 1000,
          },
        }
      );

      logger.info('🔵 DEBUG: Worker instance created');

      // Setup event listeners
      this.setupEventListeners();

      this.isRunning = true;

      logger.info(
        {
          concurrency: appConfig.processing.maxWorkers,
          whisperModel: appConfig.whisper.model,
        },
        '⚙️ Transcription worker started successfully'
      );
    } catch (error) {
      logger.error({ error }, 'Failed to start transcription worker');
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      if (this.worker) {
        await this.worker.close();
        this.worker = null;
      }

      await redisConnection.quit();

      this.isRunning = false;

      logger.info(
        {
          processedJobs: this.processedJobs,
          failedJobs: this.failedJobs,
        },
        '✅ Transcription worker stopped gracefully'
      );
    } catch (error) {
      logger.error({ error }, 'Error stopping transcription worker');
      throw error;
    }
  }

  // ===========================================================================
  // EVENT LISTENERS
  // ===========================================================================

  private setupEventListeners(): void {
    if (!this.worker) return;

    logger.info('🔵 DEBUG: Setting up event listeners');

    this.worker.on('completed', (job: Job) => {
      this.processedJobs++;
      logger.info(
        {
          jobId: job.id,
          fileName: job.data.fileName,
          duration: job.finishedOn ? job.finishedOn - (job.processedOn || 0) : 0,
        },
        '✅ Job completed successfully'
      );
    });

    this.worker.on('failed', async (job: Job | undefined, error: Error) => {
      this.failedJobs++;
      logger.error(
        {
          jobId: job?.id,
          fileName: job?.data.fileName,
          error: error.message,
          attemptsMade: job?.attemptsMade,
        },
        '❌ Job failed'
      );

      // Unmark file as processed so it can be retried
      if (job?.data.filePath) {
        await fileTracker.unmarkProcessed(job.data.filePath);
        logger.debug({ filePath: job.data.filePath }, 'Unmarked failed file for retry');
      }
    });

    this.worker.on('active', (job: Job) => {
      logger.info(
        {
          jobId: job.id,
          fileName: job.data.fileName,
        },
        '▶️ Job started processing (EVENT LISTENER)'
      );
      logger.info({ jobId: job.id }, '🔵 DEBUG: active event fired');
    });

    this.worker.on('stalled', (jobId: string) => {
      logger.warn({ jobId }, '⚠️ Job stalled');
    });

    this.worker.on('error', (error: Error) => {
      logger.error({ error }, '❌ Worker error');
    });
  }

  // ===========================================================================
  // JOB PROCESSING
  // ===========================================================================

  private async processJob(job: Job): Promise<any> {
    logger.info({ jobId: job.id }, '🟢 DEBUG: processJob ENTRY POINT');

    const jobData: TranscriptionJob = job.data;
    const startTime = Date.now();

    logger.info(
      {
        jobId: job.id,
        fileName: jobData.fileName,
        filePath: jobData.filePath,
      },
      'Processing transcription job'
    );

    try {
      // Update job progress
      await job.updateProgress(0);

      // Validate input file
      await this.validateInputFile(jobData.filePath);
      await job.updateProgress(10);

      // Ensure output directories exist
      await this.ensureDirectories();
      await job.updateProgress(20);

      // Generate output file path (preserving directory structure)
      const outputPath = this.generateOutputPath(jobData.filePath);

      // Run transcription
      await job.updateProgress(30);
      const transcriptPath = await this.runTranscription(
        jobData.filePath,
        outputPath,
        (progress) => job.updateProgress(30 + progress * 0.6) // 30-90%
      );
      await job.updateProgress(90);

      // Move completed file
      await this.moveCompletedFile(jobData.filePath);
      await job.updateProgress(95);

      // Calculate processing time
      const processingTime = Date.now() - startTime;

      await job.updateProgress(100);

      logger.info(
        {
          jobId: job.id,
          fileName: jobData.fileName,
          transcriptPath,
          processingTime: `${(processingTime / 1000).toFixed(2)}s`,
        },
        '✅ Transcription completed successfully'
      );

      return {
        success: true,
        transcriptPath,
        processingTime,
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error(
        {
          jobId: job.id,
          fileName: jobData.fileName,
          error,
        },
        '❌ Transcription failed'
      );

      // Move failed file
      await this.moveFailedFile(jobData.filePath).catch(() => {});

      throw error;
    }
  }

  // ===========================================================================
  // TRANSCRIPTION LOGIC
  // ===========================================================================

  private async runTranscription(
    inputPath: string,
    outputPath: string,
    onProgress: (progress: number) => Promise<void>
  ): Promise<string> {
    const outputDir = dirname(outputPath);

    // Ensure output directory exists (including subdirectories)
    await mkdir(outputDir, { recursive: true });

    // Check if Whisper.cpp is available
    const binaryExists = await whisperService.validateBinary();

    if (!binaryExists) {
      // Fall back to simulation if Whisper.cpp is not installed
      logger.warn('Whisper.cpp not found, using simulation mode');
      return await this.simulateTranscription(inputPath, outputPath, onProgress);
    }

    try {
      // Use whisperService which has the correct command format
      logger.info({ inputPath, outputDir }, 'Running Whisper.cpp transcription via whisperService');

      const result = await fasterWhisperService.transcribe(inputPath, outputDir, {
        model: 'medium',
        device: 'cpu',
        computeType: 'int8', // int8 for CPU compatibility (float16 requires GPU)
        beamSize: 5,
        vadFilter: false, // Disable VAD for now (can enable later)
        wordTimestamps: false,
      });

      logger.info({ transcriptPath: result.text }, 'Whisper.cpp transcription completed');

      // whisperService returns the full result, we need the file path
      // The transcript file will be: outputDir/basename.txt
      const inputBasename = basename(inputPath, extname(inputPath));
      const transcriptPath = join(outputDir, `${inputBasename}.txt`);

      return transcriptPath;
    } catch (error) {
      logger.error({ error, inputPath }, 'Whisper.cpp transcription failed');
      throw error; // Re-throw the error to fail the job properly
    }
  }

  // ===========================================================================
  // SIMULATION (FOR TESTING WITHOUT WHISPER)
  // ===========================================================================

  private async simulateTranscription(
    inputPath: string,
    outputPath: string,
    onProgress: (progress: number) => Promise<void>
  ): Promise<string> {
    logger.info('⚠️ Running simulated transcription (Whisper.cpp not configured)');

    const transcriptPath = `${outputPath}.txt`;

    // Simulate processing time based on file size
    const simulationSteps = 10;
    for (let i = 0; i <= simulationSteps; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200)); // 200ms per step
      await onProgress(i / simulationSteps);
    }

    // Create a mock transcript file
    const mockTranscript = `[SIMULATED TRANSCRIPT]

This is a simulated transcript for testing purposes.
The actual transcription will be performed by Whisper.cpp once configured.

Input file: ${inputPath}
Timestamp: ${new Date().toISOString()}

To enable real transcription:
1. Install Whisper.cpp binary
2. Update WHISPER_BINARY_PATH in .env
3. Restart the application

[END OF SIMULATED TRANSCRIPT]
`;

    await writeFile(transcriptPath, mockTranscript, 'utf-8');

    return transcriptPath;
  }

  // ===========================================================================
  // FILE MANAGEMENT
  // ===========================================================================

  private async validateInputFile(filePath: string): Promise<void> {
    try {
      await access(filePath, constants.R_OK);
    } catch (error) {
      throw new Error(`Input file not accessible: ${filePath}`);
    }
  }

  private async ensureDirectories(): Promise<void> {
    const directories = [
      appConfig.processing.outputDirectory,
      appConfig.processing.completedDirectory,
      appConfig.processing.failedDirectory,
    ];

    for (const dir of directories) {
      await mkdir(dir, { recursive: true });
    }
  }

  private generateOutputPath(filePath: string): string {
    // Extract the relative path from the watch directory
    const watchDir = appConfig.processing.watchDirectory;
    const relativePath = filePath.startsWith(watchDir)
      ? filePath
          .slice(watchDir.length)
          .replace(/^\//, '') // Remove leading slash
      : basename(filePath); // Fallback to just filename if not in watch dir

    // Get the directory structure and filename
    const relativeDir = dirname(relativePath);
    const fileName = basename(relativePath);
    const baseName = basename(fileName, extname(fileName));

    // Build output path preserving directory structure
    const outputDir =
      relativeDir && relativeDir !== '.'
        ? join(appConfig.processing.outputDirectory, relativeDir)
        : appConfig.processing.outputDirectory;

    // Return path without timestamp (we want consistent filenames)
    return join(outputDir, baseName);
  }

  private async moveCompletedFile(filePath: string): Promise<void> {
    try {
      // Extract the relative path from the watch directory to preserve structure
      const watchDir = appConfig.processing.watchDirectory;
      const relativePath = filePath.startsWith(watchDir)
        ? filePath
            .slice(watchDir.length)
            .replace(/^\//, '') // Remove leading slash
        : basename(filePath); // Fallback to just filename if not in watch dir

      // Get the directory structure and filename
      const relativeDir = dirname(relativePath);
      const fileName = basename(relativePath);

      // Build completed path preserving directory structure
      const completedDir =
        relativeDir && relativeDir !== '.'
          ? join(appConfig.processing.completedDirectory, relativeDir)
          : appConfig.processing.completedDirectory;

      // Ensure the completed subdirectory exists
      await mkdir(completedDir, { recursive: true });

      const destPath = join(completedDir, fileName);
      await rename(filePath, destPath);
      logger.debug({ from: filePath, to: destPath }, 'Moved completed file');
    } catch (error) {
      logger.warn({ error, filePath }, 'Failed to move completed file');
    }
  }

  private async moveFailedFile(filePath: string): Promise<void> {
    try {
      // Extract the relative path from the watch directory to preserve structure
      const watchDir = appConfig.processing.watchDirectory;
      const relativePath = filePath.startsWith(watchDir)
        ? filePath
            .slice(watchDir.length)
            .replace(/^\//, '') // Remove leading slash
        : basename(filePath); // Fallback to just filename if not in watch dir

      // Get the directory structure and filename
      const relativeDir = dirname(relativePath);
      const fileName = basename(relativePath);

      // Build failed path preserving directory structure
      const failedDir =
        relativeDir && relativeDir !== '.'
          ? join(appConfig.processing.failedDirectory, relativeDir)
          : appConfig.processing.failedDirectory;

      // Ensure the failed subdirectory exists
      await mkdir(failedDir, { recursive: true });

      const destPath = join(failedDir, fileName);
      await rename(filePath, destPath);
      logger.debug({ from: filePath, to: destPath }, 'Moved failed file');
    } catch (error) {
      logger.warn({ error, filePath }, 'Failed to move failed file');
    }
  }

  // ===========================================================================
  // GETTERS
  // ===========================================================================

  get running(): boolean {
    return this.isRunning;
  }

  get stats() {
    return {
      processedJobs: this.processedJobs,
      failedJobs: this.failedJobs,
      successRate:
        this.processedJobs > 0 ? ((this.processedJobs / (this.processedJobs + this.failedJobs)) * 100).toFixed(2) : 0,
    };
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const transcriptionWorker = new TranscriptionWorker();

// =============================================================================
// STANDALONE EXECUTION
// =============================================================================

if (import.meta.main) {
  const worker = new TranscriptionWorker();

  worker.start().catch((error) => {
    logger.fatal({ error }, 'Failed to start transcription worker');
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down worker...');
    await worker.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down worker...');
    await worker.stop();
    process.exit(0);
  });
}
