/**
 * 🔮 Transcription Palantir - Logging Utility
 * 
 * Structured logging with Pino for development and production
 */

import pino from 'pino';
import { appConfig } from '../config/index.js';

// =============================================================================
// LOGGER CONFIGURATION
// =============================================================================

const loggerConfig: pino.LoggerOptions = {
  level: appConfig.logLevel,
  name: appConfig.serviceName,
  
  // Development-friendly formatting
  ...(appConfig.env === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
        messageFormat: '{levelLabel} - {msg}',
      },
    },
  }),

  // Production structured logging
  ...(appConfig.env === 'production' && {
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  }),

  // Base fields for all log entries
  base: {
    service: appConfig.serviceName,
    version: process.env.npm_package_version || '1.0.0',
    environment: appConfig.env,
  },
};

// =============================================================================
// LOGGER INSTANCE
// =============================================================================

export const logger = pino(loggerConfig);

// =============================================================================
// SPECIALIZED LOGGERS
// =============================================================================

export const apiLogger = logger.child({ component: 'api' });
export const workerLogger = logger.child({ component: 'worker' });
export const queueLogger = logger.child({ component: 'queue' });
export const fileWatcherLogger = logger.child({ component: 'file-watcher' });
export const transcriptionLogger = logger.child({ component: 'transcription' });

// =============================================================================
// LOGGING UTILITIES
// =============================================================================

export interface LogContext {
  jobId?: string;
  workerId?: string;
  fileName?: string;
  requestId?: string;
  userId?: string;
  duration?: number;
  [key: string]: any;
}

export function logJobStart(context: LogContext): void {
  transcriptionLogger.info(
    {
      jobId: context.jobId,
      fileName: context.fileName,
      workerId: context.workerId,
    },
    'Transcription job started'
  );
}

export function logJobComplete(context: LogContext & { duration: number }): void {
  transcriptionLogger.info(
    {
      jobId: context.jobId,
      fileName: context.fileName,
      workerId: context.workerId,
      duration: context.duration,
    },
    'Transcription job completed successfully'
  );
}

export function logJobError(context: LogContext & { error: Error }): void {
  transcriptionLogger.error(
    {
      jobId: context.jobId,
      fileName: context.fileName,
      workerId: context.workerId,
      error: {
        message: context.error.message,
        stack: context.error.stack,
        name: context.error.name,
      },
    },
    'Transcription job failed'
  );
}

export function logApiRequest(context: LogContext & { method: string; url: string; statusCode: number }): void {
  apiLogger.info(
    {
      requestId: context.requestId,
      method: context.method,
      url: context.url,
      statusCode: context.statusCode,
      duration: context.duration,
    },
    'API request processed'
  );
}

export function logWorkerStart(context: LogContext): void {
  workerLogger.info(
    {
      workerId: context.workerId,
      pid: process.pid,
    },
    'Worker started'
  );
}

export function logWorkerStop(context: LogContext): void {
  workerLogger.info(
    {
      workerId: context.workerId,
      pid: process.pid,
    },
    'Worker stopped'
  );
}

export function logQueueEvent(event: string, context: LogContext): void {
  queueLogger.info(
    {
      event,
      jobId: context.jobId,
      queueSize: context.queueSize,
    },
    `Queue event: ${event}`
  );
}

export function logFileWatcherEvent(event: string, context: LogContext): void {
  fileWatcherLogger.info(
    {
      event,
      fileName: context.fileName,
      filePath: context.filePath,
      fileSize: context.fileSize,
    },
    `File watcher event: ${event}`
  );
}

// =============================================================================
// ERROR LOGGING UTILITIES
// =============================================================================

export function logError(error: Error, context: LogContext = {}): void {
  logger.error(
    {
      ...context,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    },
    'Unhandled error occurred'
  );
}

export function logFatalError(error: Error, context: LogContext = {}): void {
  logger.fatal(
    {
      ...context,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    },
    'Fatal error - application will exit'
  );
}

// =============================================================================
// PERFORMANCE LOGGING
// =============================================================================

export function createTimer(label: string, context: LogContext = {}) {
  const start = Date.now();
  
  return {
    end: (additionalContext: LogContext = {}) => {
      const duration = Date.now() - start;
      logger.debug(
        {
          ...context,
          ...additionalContext,
          duration,
          label,
        },
        `Timer: ${label} completed in ${duration}ms`
      );
      return duration;
    },
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

export default logger;
