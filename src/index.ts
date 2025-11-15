/**
 * 🔮 Transcription Palantir - Main Application Entry Point
 * 
 * Modern TypeScript transcription system with BullMQ, Redis, and Whisper.cpp
 */

import { logger, logFatalError } from './utils/logger.js';
import { appConfig } from './config/index.js';
import { transcriptionQueue } from './services/queue.js';
import { apiServer } from './api/server.js';

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
      logger.info({
        version: process.env.npm_package_version || '1.0.0',
        environment: appConfig.env,
        port: appConfig.port,
        nodeVersion: process.version,
      }, '🔮 Starting Transcription Palantir...');

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

    // Initialize API server
    await apiServer.initialize();
    logger.info('✅ API server initialized');

    // TODO: Initialize other services
    // - File watcher service
    // - Worker manager
    // - Health check service
  }

  private async closeServices(): Promise<void> {
    logger.info('Closing services...');

    // Close queue service
    await transcriptionQueue.close();
    logger.info('✅ Queue service closed');

    // Close API server (already stopped in stopComponents)
    // No additional cleanup needed
  }

  // ===========================================================================
  // COMPONENT MANAGEMENT
  // ===========================================================================

  private async startComponents(): Promise<void> {
    logger.info('Starting application components...');

    // Start API server
    await apiServer.start();
    logger.info('✅ API server started');

    // TODO: Start other components
    // - File watcher
    // - Worker processes
    // - Metrics collection

    logger.info('✅ All components started');
  }

  private async stopComponents(): Promise<void> {
    logger.info('Stopping application components...');

    // Stop API server
    await apiServer.stop();
    logger.info('✅ API server stopped');

    // TODO: Stop other components gracefully
    // - File watcher
    // - Worker processes

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
      logger.fatal({
        reason,
        promise,
        component: 'unhandledRejection',
      }, 'Unhandled promise rejection');
      process.exit(1);
    });

    // Log process warnings
    process.on('warning', (warning) => {
      logger.warn({
        name: warning.name,
        message: warning.message,
        stack: warning.stack,
      }, 'Process warning');
    });
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  private logConfigurationSummary(): void {
    logger.info({
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
    }, 'Configuration summary');
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
