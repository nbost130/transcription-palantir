/**
 * 🔮 Transcription Palantir - Main Application Entry Point
 *
 * Modern TypeScript transcription system with BullMQ, Redis, and Whisper.cpp
 */

import { apiServer } from './api/server.js';
import { appConfig } from './config/index.js';
import { fileTracker } from './services/file-tracker.js';

import { fileWatcher } from './services/file-watcher.js';
import { processGuard } from './services/process-guard.js';
import { workManager } from './services/work-manager.js';
import { transcriptionQueue } from './services/queue.js';
import { logFatalError, logger } from './utils/logger.js';
import { transcriptionWorker } from './workers/transcription-worker.js';

// =============================================================================
// APPLICATION CLASS
// =============================================================================

class TranscriptionPalantir {
  private isShuttingDown = false;

  constructor() {
    this.setupProcessHandlers();
  }

  // ===========================================================================
  // APPLICATION LIFECYCLE
  // ===========================================================================

  async start(): Promise<void> {
    try {
      logger.info(
        {
          version: process.env.npm_package_version || '1.0.0',
          environment: appConfig.env,
          port: appConfig.port,
          nodeVersion: process.version,
        },
        '🔮 Starting Transcription Palantir...'
      );

      // Acquire singleton lock — Redis-backed mutex with TTL refresh.
      // Survives clean deploys (outgoing process releases on stop) and
      // crashes (TTL expires; next start takes over).
      const acquired = await processGuard.acquire();
      if (!acquired) {
        logger.error('🚨 Another Palantir instance already holds the singleton lock — refusing to start');
        process.exit(1);
      }

      // Initialize core services
      await this.initializeServices();

      // Start application components
      await this.startComponents();

      logger.info('🚀 Transcription Palantir started successfully');

      // Log configuration summary
      this.logConfigurationSummary();
    } catch (error) {
      logFatalError(error as Error, { component: 'startup' });
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    logger.info('🛑 Shutting down Transcription Palantir...');

    try {
      // Stop components in reverse order
      await this.stopComponents();

      // Close services
      await this.closeServices();

      logger.info('✅ Transcription Palantir stopped gracefully');
    } catch (error) {
      logger.error({ error }, 'Error during shutdown');
    }
  }

  // ===========================================================================
  // SERVICE MANAGEMENT
  // ===========================================================================

  private async initializeServices(): Promise<void> {
    logger.info('Initializing core services...');

    // Initialize queue service
    await transcriptionQueue.initialize();
    logger.info('✅ Queue service initialized');

    // Phase 2: ensure the private working tree, archive, and duplicates
    // directories exist. ReconciliationService boot-scan removed —
    // the queue (Redis) is now the source of truth; orphaned work
    // dirs are surfaced for inspection but not auto-requeued.
    await workManager.ensureLayout();
    // Phase 2: list work dirs surviving across restart. These MAY be orphaned
    // (job staged, never finished) OR legitimately pending (job in BullMQ queue,
    // waiting for a worker). listOrphanedWorkDirs() currently does NOT cross-check
    // the queue — that filter lands in Phase 3 alongside the dedup-saved KPI.
    // Until then, log at info-level with honest naming so a normal post-restart
    // state doesn't look like an alert.
    const workDirs = await workManager.listOrphanedWorkDirs();
    if (workDirs.length > 0) {
      logger.info(
        { workDirs: workDirs.slice(0, 20), count: workDirs.length },
        'Pre-existing work directories carried over restart (may be in-flight or orphaned — Phase 3 will filter against queue)'
      );
    }

    // TODO: Initialize other services
    // - File watcher service
    // - Worker manager
    // - Metrics service
  }

  private async closeServices(): Promise<void> {
    logger.info('Closing services...');

    // Close file tracker
    await fileTracker.disconnect();
    logger.info('✅ File tracker closed');

    // Close queue service
    await transcriptionQueue.close();
    logger.info('✅ Queue service closed');

    // Release singleton lock (Redis mutex — see process-guard.ts)
    await processGuard.release();
    logger.info('✅ Singleton lock released');
  }

  // ===========================================================================
  // COMPONENT MANAGEMENT
  // ===========================================================================

  private async startComponents(): Promise<void> {
    logger.info('Starting application components...');

    // Start API server
    await apiServer.start();

    // Start transcription worker
    await transcriptionWorker.start();

    // Start file watcher
    await fileWatcher.start();

    // TODO: Start other components
    // - Metrics collection

    logger.info('✅ All components started');
  }

  private async stopComponents(): Promise<void> {
    logger.info('Stopping application components...');

    // Stop file watcher (stop accepting new jobs first)
    await fileWatcher.stop();

    // Stop transcription worker (finish processing current jobs)
    await transcriptionWorker.stop();

    // Stop API server
    await apiServer.stop();

    logger.info('✅ All components stopped');
  }

  // ===========================================================================
  // PROCESS HANDLERS
  // ===========================================================================

  private setupProcessHandlers(): void {
    // Graceful shutdown on SIGTERM
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, initiating graceful shutdown...');
      await this.stop();
      process.exit(0);
    });

    // Graceful shutdown on SIGINT (Ctrl+C)
    process.on('SIGINT', async () => {
      logger.info('Received SIGINT, initiating graceful shutdown...');
      await this.stop();
      process.exit(0);
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logFatalError(error, { component: 'uncaughtException' });
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.fatal(
        {
          reason,
          promise,
          component: 'unhandledRejection',
        },
        'Unhandled promise rejection'
      );
      process.exit(1);
    });

    // Log process warnings
    process.on('warning', (warning) => {
      logger.warn(
        {
          name: warning.name,
          message: warning.message,
          stack: warning.stack,
        },
        'Process warning'
      );
    });
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  private logConfigurationSummary(): void {
    logger.info(
      {
        redis: {
          host: appConfig.redis.host,
          port: appConfig.redis.port,
          db: appConfig.redis.db,
        },
        processing: {
          watchDirectory: appConfig.processing.watchDirectory,
          outputDirectory: appConfig.processing.outputDirectory,
          maxWorkers: appConfig.processing.maxWorkers,
          supportedFormats: appConfig.processing.supportedFormats,
        },
        whisper: {
          model: appConfig.whisper.model,
          computeType: appConfig.whisper.computeType,
          language: appConfig.whisper.language,
        },
      },
      'Configuration summary'
    );
  }
}

// =============================================================================
// APPLICATION BOOTSTRAP
// =============================================================================

async function bootstrap(): Promise<void> {
  const app = new TranscriptionPalantir();
  await app.start();
}

// Start the application if this file is run directly
if (import.meta.main) {
  bootstrap().catch((error) => {
    logFatalError(error, { component: 'bootstrap' });
    process.exit(1);
  });
}

export default TranscriptionPalantir;
