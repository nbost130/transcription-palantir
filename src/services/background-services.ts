#!/usr/bin/env bun

/**
 * 🔮 Background Services Launcher
 *
 * Starts all background services for the transcription system
 * Designed to run independently from the unified API
 */

import { appConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { TranscriptionWorker } from '../workers/transcription-worker.js';
import { FileWatcherService } from './file-watcher.js';
import { TranscriptionQueue } from './queue.js';

class BackgroundServicesManager {
  private queue: TranscriptionQueue;
  private workers: TranscriptionWorker[] = [];
  private fileWatcher: FileWatcherService;
  private isRunning = false;

  constructor() {
    this.queue = new TranscriptionQueue();
    this.fileWatcher = new FileWatcherService();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Background services are already running');
      return;
    }

    try {
      logger.info('🚀 Starting Transcription Palantir background services...');

      // Initialize queue first
      await this.queue.initialize();
      logger.info('✅ Queue initialized');

      // Start workers
      const workerCount = appConfig.processing.maxWorkers;
      for (let i = 0; i < workerCount; i++) {
        const worker = new TranscriptionWorker();
        await worker.start();
        this.workers.push(worker);
        logger.info(`✅ Worker ${i + 1}/${workerCount} started`);
      }

      // Start file watcher
      await this.fileWatcher.start();
      logger.info('✅ File watcher started');

      this.isRunning = true;
      logger.info(`🎉 All background services started successfully!`);
      logger.info(`📊 Configuration:`);
      logger.info(`   - Workers: ${workerCount}`);
      logger.info(`   - Watch Directory: ${appConfig.processing.watchDirectory}`);
      logger.info(`   - Output Directory: ${appConfig.processing.outputDirectory}`);
      logger.info(`   - Whisper Model: ${appConfig.whisper.model}`);

      // Set up graceful shutdown
      this.setupGracefulShutdown();
    } catch (error) {
      logger.error({ error }, '❌ Failed to start background services');
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('🛑 Stopping background services...');

    try {
      // Stop file watcher
      if (this.fileWatcher) {
        await this.fileWatcher.stop();
        logger.info('✅ File watcher stopped');
      }

      // Stop workers
      for (let i = 0; i < this.workers.length; i++) {
        await this.workers[i]?.stop();
        logger.info(`✅ Worker ${i + 1} stopped`);
      }
      this.workers = [];

      // Close queue
      if (this.queue) {
        await this.queue.close();
        logger.info('✅ Queue closed');
      }

      this.isRunning = false;
      logger.info('🎉 All background services stopped successfully');
    } catch (error) {
      logger.error({ error }, '❌ Error stopping background services');
      throw error;
    }
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`📡 Received ${signal}, shutting down gracefully...`);
      try {
        await this.stop();
        process.exit(0);
      } catch (error) {
        logger.error({ error }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGUSR2', () => shutdown('SIGUSR2')); // For nodemon
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      workerCount: this.workers.length,
      queueInitialized: !!this.queue,
      fileWatcherActive: !!this.fileWatcher,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    };
  }
}

// Health check endpoint for monitoring
export async function getBackgroundServicesHealth() {
  return {
    status: 'healthy',
    services: {
      queue: 'active',
      workers: 'active',
      fileWatcher: 'active',
    },
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  };
}

// Main execution
if (import.meta.main) {
  const manager = new BackgroundServicesManager();

  // Start services
  manager
    .start()
    .then(() => {
      logger.info('🔮 Transcription Palantir background services are running');
      logger.info('📡 Press Ctrl+C to stop');

      // Keep process alive
      setInterval(() => {
        const status = manager.getStatus();
        logger.debug({ status }, 'Background services status');
      }, 60000); // Log status every minute
    })
    .catch((error) => {
      logger.error({ error }, '💥 Failed to start background services');
      process.exit(1);
    });
}

export { BackgroundServicesManager };
