/**
 * 🔮 Transcription Palantir - Transcription Worker
 *
 * BullMQ worker for processing transcription jobs with Whisper.cpp
 */

import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { spawn } from 'child_process';
import { mkdir, access, rename, copyFile, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { appConfig, getRedisUrl, getWhisperCommand } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { TranscriptionJob } from '../types/index.js';

// =============================================================================
// REDIS CONNECTION
// =============================================================================

const redisConnection = new Redis(getRedisUrl(), {
  maxRetriesPerRequest: appConfig.redis.maxRetries,
  lazyConnect: true,
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
      await redisConnection.connect();

      this.worker = new Worker(
        'transcription',
        async (job: Job) => await this.processJob(job),
        {
          connection: redisConnection,
          concurrency: appConfig.processing.maxWorkers,
          limiter: {
            max: appConfig.processing.maxWorkers,
            duration: 1000,
          },
        }
      );

      // Setup event listeners
      this.setupEventListeners();

      this.isRunning = true;

      logger.info({
        concurrency: appConfig.processing.maxWorkers,
        whisperModel: appConfig.whisper.model,
      }, '⚙️ Transcription worker started successfully');

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

      logger.info({
        processedJobs: this.processedJobs,
        failedJobs: this.failedJobs,
      }, '✅ Transcription worker stopped gracefully');

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

    this.worker.on('completed', (job: Job) => {
      this.processedJobs++;
      logger.info({
        jobId: job.id,
        fileName: job.data.fileName,
        duration: job.finishedOn ? job.finishedOn - (job.processedOn || 0) : 0,
      }, '✅ Job completed successfully');
    });

    this.worker.on('failed', (job: Job | undefined, error: Error) => {
      this.failedJobs++;
      logger.error({
        jobId: job?.id,
        fileName: job?.data.fileName,
        error: error.message,
        attemptsMade: job?.attemptsMade,
      }, '❌ Job failed');
    });

    this.worker.on('active', (job: Job) => {
      logger.info({
        jobId: job.id,
        fileName: job.data.fileName,
      }, '▶️ Job started processing');
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
    const jobData: TranscriptionJob = job.data;
    const startTime = Date.now();

    logger.info({
      jobId: job.id,
      fileName: jobData.fileName,
      filePath: jobData.filePath,
    }, 'Processing transcription job');

    try {
      // Update job progress
      await job.updateProgress(0);

      // Validate input file
      await this.validateInputFile(jobData.filePath);
      await job.updateProgress(10);

      // Ensure output directories exist
      await this.ensureDirectories();
      await job.updateProgress(20);

      // Generate output file path
      const outputPath = this.generateOutputPath(jobData.fileName);

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

      logger.info({
        jobId: job.id,
        fileName: jobData.fileName,
        transcriptPath,
        processingTime: `${(processingTime / 1000).toFixed(2)}s`,
      }, '✅ Transcription completed successfully');

      return {
        success: true,
        transcriptPath,
        processingTime,
        completedAt: new Date().toISOString(),
      };

    } catch (error) {
      logger.error({
        jobId: job.id,
        fileName: jobData.fileName,
        error,
      }, '❌ Transcription failed');

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
    return new Promise((resolve, reject) => {
      const outputDir = dirname(outputPath);
      const outputBaseName = basename(outputPath, extname(outputPath));

      // Get Whisper command
      const command = getWhisperCommand(inputPath, join(outputDir, outputBaseName));

      logger.debug({ command }, 'Running Whisper command');

      // For now, we'll simulate transcription since Whisper.cpp might not be installed yet
      // TODO: Replace with actual Whisper.cpp execution
      const useSimulation = appConfig.env !== 'production';

      if (useSimulation) {
        // Simulate transcription process
        this.simulateTranscription(inputPath, outputPath, onProgress)
          .then(resolve)
          .catch(reject);
        return;
      }

      // If not using simulation, reject since Whisper is not configured
      reject(new Error('Whisper.cpp is not configured. Set useSimulation to true or configure Whisper.'));

      // Real Whisper.cpp execution (uncomment when Whisper is installed)
      /*
      const whisperProcess = spawn(command[0], command.slice(1), {
        cwd: outputDir,
      });

      let stderr = '';

      whisperProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        // Parse progress from stderr if available
        // Update progress based on Whisper output
      });

      whisperProcess.on('close', (code) => {
        if (code === 0) {
          const transcriptPath = `${outputPath}.txt`;
          resolve(transcriptPath);
        } else {
          reject(new Error(`Whisper process exited with code ${code}: ${stderr}`));
        }
      });

      whisperProcess.on('error', (error) => {
        reject(new Error(`Failed to start Whisper: ${error.message}`));
      });
      */
    });
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
      await new Promise(resolve => setTimeout(resolve, 200)); // 200ms per step
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

  private generateOutputPath(fileName: string): string {
    const baseName = basename(fileName, extname(fileName));
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return join(appConfig.processing.outputDirectory, `${baseName}_${timestamp}`);
  }

  private async moveCompletedFile(filePath: string): Promise<void> {
    try {
      const fileName = basename(filePath);
      const destPath = join(appConfig.processing.completedDirectory, fileName);
      await rename(filePath, destPath);
      logger.debug({ from: filePath, to: destPath }, 'Moved completed file');
    } catch (error) {
      logger.warn({ error, filePath }, 'Failed to move completed file');
    }
  }

  private async moveFailedFile(filePath: string): Promise<void> {
    try {
      const fileName = basename(filePath);
      const destPath = join(appConfig.processing.failedDirectory, fileName);
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
      successRate: this.processedJobs > 0
        ? ((this.processedJobs / (this.processedJobs + this.failedJobs)) * 100).toFixed(2)
        : 0,
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
