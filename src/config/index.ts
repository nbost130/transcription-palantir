/**
 * 🔮 Transcription Palantir - Configuration Management
 *
 * Centralized configuration with environment-specific overrides
 */

import { config } from 'dotenv';
import { z } from 'zod';
import type { AppConfig } from '../types/index.js';

// Load environment variables
config();

// Application version
export const APP_VERSION = '1.0.2';

// =============================================================================
// ENVIRONMENT VALIDATION SCHEMA
// =============================================================================

const EnvSchema = z.object({
  // Core Settings
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  SERVICE_NAME: z.string().default('transcription-palantir'),

  // Redis Configuration
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().default(0),
  REDIS_MAX_RETRIES: z.coerce.number().default(3),
  REDIS_RETRY_DELAY: z.coerce.number().default(1000),
  REDIS_CONNECT_TIMEOUT: z.coerce.number().default(10000),
  REDIS_RECONNECT_ON_ERROR: z.coerce.boolean().default(true),
  REDIS_ENABLE_OFFLINE_QUEUE: z.coerce.boolean().default(true),

  // Whisper Configuration
  WHISPER_MODEL: z.string().default('medium'),
  WHISPER_BINARY_PATH: z.string().default('/usr/local/bin/whisper'),
  WHISPER_PYTHON_PATH: z.string().default('/home/nbost/faster-whisper-env/bin/python3'),
  COMPUTE_TYPE: z.string().default('float16'),
  WHISPER_LANGUAGE: z.string().default('auto'),
  WHISPER_TASK: z.string().default('transcribe'),
  WHISPER_USE_PYTHON: z.coerce.boolean().default(true),

  // File Processing
  WATCH_DIRECTORY: z.string().default('/tmp/audio-input'),
  OUTPUT_DIRECTORY: z.string().default('/tmp/transcripts'),
  COMPLETED_DIRECTORY: z.string().default('/tmp/transcripts/completed'),
  FAILED_DIRECTORY: z.string().default('/tmp/transcripts/failed'),
  MAX_FILE_SIZE: z.coerce.number().default(500),
  MIN_FILE_SIZE: z.coerce.number().default(0.1),
  SUPPORTED_FORMATS: z.string().default('mp3,wav,m4a,flac,ogg,mp4,mov'),

  // Worker Configuration
  MAX_WORKERS: z.coerce.number().default(4),
  MIN_WORKERS: z.coerce.number().default(1),
  JOB_TIMEOUT: z.coerce.number().default(3600000),
  MAX_JOB_ATTEMPTS: z.coerce.number().default(3),
  STALLED_INTERVAL: z.coerce.number().default(30000), // Check every 30s
  LOCK_DURATION: z.coerce.number().default(60000), // 60s lock duration

  // API Configuration
  API_PREFIX: z.string().default('/api/v1'),
  CORS_ORIGIN: z.string().default('*'),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW: z.coerce.number().default(900000),
  API_KEY: z.string().optional(),
  JWT_SECRET: z.string().optional(),

  // Monitoring
  HEALTH_CHECK_INTERVAL: z.coerce.number().default(30000),
  METRICS_ENABLED: z.coerce.boolean().default(true),
  PROMETHEUS_PORT: z.coerce.number().default(9090),
});

// =============================================================================
// CONFIGURATION FACTORY
// =============================================================================

function createConfig(): AppConfig {
  const env = EnvSchema.parse(process.env);

  return {
    env: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    serviceName: env.SERVICE_NAME,

    redis: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD,
      db: env.REDIS_DB,
      maxRetries: env.REDIS_MAX_RETRIES,
      retryDelay: env.REDIS_RETRY_DELAY,
      connectTimeout: env.REDIS_CONNECT_TIMEOUT,
      reconnectOnError: env.REDIS_RECONNECT_ON_ERROR,
      enableOfflineQueue: env.REDIS_ENABLE_OFFLINE_QUEUE,
    },

    whisper: {
      model: env.WHISPER_MODEL,
      binaryPath: env.WHISPER_BINARY_PATH,
      pythonPath: env.WHISPER_PYTHON_PATH,
      computeType: env.COMPUTE_TYPE,
      language: env.WHISPER_LANGUAGE,
      task: env.WHISPER_TASK,
      usePython: env.WHISPER_USE_PYTHON,
    },

    processing: {
      watchDirectory: env.WATCH_DIRECTORY,
      outputDirectory: env.OUTPUT_DIRECTORY,
      completedDirectory: env.COMPLETED_DIRECTORY,
      failedDirectory: env.FAILED_DIRECTORY,
      maxFileSize: env.MAX_FILE_SIZE,
      minFileSize: env.MIN_FILE_SIZE,
      supportedFormats: env.SUPPORTED_FORMATS.split(','),
      maxWorkers: env.MAX_WORKERS,
      minWorkers: env.MIN_WORKERS,
      jobTimeout: env.JOB_TIMEOUT,
      maxAttempts: env.MAX_JOB_ATTEMPTS,
      stalledInterval: env.STALLED_INTERVAL,
      lockDuration: env.LOCK_DURATION,
    },

    api: {
      prefix: env.API_PREFIX,
      corsOrigin: env.CORS_ORIGIN,
      rateLimitMax: env.RATE_LIMIT_MAX,
      rateLimitWindow: env.RATE_LIMIT_WINDOW,
      apiKey: env.API_KEY,
      jwtSecret: env.JWT_SECRET,
    },

    monitoring: {
      healthCheckInterval: env.HEALTH_CHECK_INTERVAL,
      metricsEnabled: env.METRICS_ENABLED,
      prometheusPort: env.PROMETHEUS_PORT,
    },
  };
}

// =============================================================================
// CONFIGURATION VALIDATION
// =============================================================================

function validateConfig(config: AppConfig): void {
  const errors: string[] = [];

  // Validate directories exist or can be created
  const directories = [
    config.processing.watchDirectory,
    config.processing.outputDirectory,
    config.processing.completedDirectory,
    config.processing.failedDirectory,
  ];

  // Check for wrong OS paths (prevents macOS paths on Linux and vice versa)
  for (const dir of directories) {
    if (process.platform === 'linux' && dir.startsWith('/Users')) {
      errors.push(`Invalid macOS path on Linux: ${dir}`);
    }
    if (process.platform === 'darwin' && dir.startsWith('/mnt')) {
      errors.push(`Invalid Linux path on macOS: ${dir}`);
    }
  }

  // Additional validation logic can be added here
  if (config.processing.maxWorkers < config.processing.minWorkers) {
    errors.push('MAX_WORKERS must be greater than or equal to MIN_WORKERS');
  }

  if (config.processing.maxFileSize <= config.processing.minFileSize) {
    errors.push('MAX_FILE_SIZE must be greater than MIN_FILE_SIZE');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export const appConfig = createConfig();
validateConfig(appConfig);

export default appConfig;

// Environment-specific configurations
export const isDevelopment = appConfig.env === 'development';
export const isProduction = appConfig.env === 'production';
export const isStaging = appConfig.env === 'staging';

// Utility functions
export function getRedisUrl(): string {
  const { host, port, password, db } = appConfig.redis;
  const auth = password ? `:${password}@` : '';
  return `redis://${auth}${host}:${port}/${db}`;
}

export function getWhisperCommand(inputFile: string, outputDir: string): string[] {
  const { binaryPath, model, computeType, language, task, usePython } = appConfig.whisper;

  if (usePython) {
    // Python Whisper command
    const args = [
      binaryPath,
      inputFile,
      '--model', model,
      '--output_format', 'txt',
      '--output_dir', outputDir,
      '--task', task,
    ];

    // Only add language if not auto-detection
    if (language && language !== 'auto') {
      args.push('--language', language);
    }

    return args;
  } else {
    // Whisper.cpp command (original)
    return [
      binaryPath,
      '--model',
      model,
      '--compute_type',
      computeType,
      '--language',
      language,
      '--task',
      task,
      '--output_format',
      'txt',
      '--output_dir',
      outputDir,
      inputFile,
    ];
  }
}
