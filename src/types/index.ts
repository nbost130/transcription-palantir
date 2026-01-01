/**
 * 🔮 Transcription Palantir - Type Definitions
 *
 * Core type definitions for the transcription system
 */

import { z } from 'zod';
import type { HealthStatus } from './health-status.js';

// =============================================================================
// JOB TYPES
// =============================================================================

export { type ErrorCode, ErrorCodes, getErrorReason, TranscriptionError } from './error-codes.js';
export { HealthStatus } from './health-status.js';

export enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  RETRYING = 'retrying',
}

export enum JobPriority {
  URGENT = 1, // < 10MB files
  HIGH = 2, // Important content
  NORMAL = 3, // Regular processing
  LOW = 4, // Large files > 100MB
}

export interface TranscriptionJob {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  status: JobStatus;
  priority: JobPriority;
  progress: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;
  attempts: number;
  maxAttempts: number;
  error?: string;
  errorCode?: string;
  errorReason?: string;
  healthStatus?: HealthStatus;
  transcriptPath?: string;
  metadata: JobMetadata;
}

export interface JobMetadata {
  originalPath: string;
  audioFormat: string;
  audioDuration?: number;
  audioChannels?: number;
  audioSampleRate?: number;
  whisperModel: string;
  language?: string;
  processingTime?: number;
  workerInfo?: WorkerInfo;
}

export interface WorkerInfo {
  workerId: string;
  workerPid: number;
  startTime: Date;
  cpuUsage?: number;
  memoryUsage?: number;
}

// =============================================================================
// API TYPES
// =============================================================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
  requestId: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface JobCreateRequest {
  filePath: string;
  priority?: JobPriority;
  metadata?: Partial<JobMetadata>;
}

export interface JobUpdateRequest {
  priority?: JobPriority;
  metadata?: Partial<JobMetadata>;
}

// =============================================================================
// SYSTEM TYPES
// =============================================================================

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  services: ServiceHealth[];
  metrics: SystemMetrics;
}

export interface ServiceHealth {
  name: string;
  status: 'up' | 'down' | 'degraded';
  lastCheck: string;
  responseTime?: number;
  error?: string;
  metadata?: Record<string, any>;
}

export interface SystemMetrics {
  jobs: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
  workers: {
    active: number;
    idle: number;
    total: number;
  };
  system: {
    cpuUsage: number;
    memoryUsage: number;
    diskUsage: number;
  };
  queue: {
    size: number;
    throughput: number;
    avgProcessingTime: number;
  };
}

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

export interface AppConfig {
  env: string;
  port: number;
  logLevel: string;
  serviceName: string;
  redis: RedisConfig;
  whisper: WhisperConfig;
  processing: ProcessingConfig;
  api: ApiConfig;
  monitoring: MonitoringConfig;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string | undefined;
  db: number;
  maxRetries: number;
  retryDelay: number;
  connectTimeout: number;
  reconnectOnError: boolean;
  enableOfflineQueue: boolean;
}

export interface WhisperConfig {
  model: string;
  binaryPath: string;
  pythonPath: string;
  computeType: string;
  language: string;
  task: string;
  usePython: boolean;
}

export interface ProcessingConfig {
  watchDirectory: string;
  outputDirectory: string;
  completedDirectory: string;
  failedDirectory: string;
  maxFileSize: number;
  minFileSize: number;
  supportedFormats: string[];
  maxWorkers: number;
  minWorkers: number;
  jobTimeout: number;
  maxAttempts: number;
  stalledInterval: number;
  lockDuration: number;
}

export interface ApiConfig {
  prefix: string;
  corsOrigin: string;
  rateLimitMax: number;
  rateLimitWindow: number;
  apiKey?: string | undefined;
  jwtSecret?: string | undefined;
}

export interface MonitoringConfig {
  healthCheckInterval: number;
  metricsEnabled: boolean;
  prometheusPort: number;
}

// =============================================================================
// ZOD SCHEMAS
// =============================================================================

export const JobCreateSchema = z.object({
  filePath: z.string().min(1),
  priority: z.nativeEnum(JobPriority).optional(),
  metadata: z
    .object({
      originalPath: z.string().optional(),
      audioFormat: z.string().optional(),
      whisperModel: z.string().optional(),
      language: z.string().optional(),
    })
    .optional(),
});

export const JobUpdateSchema = z.object({
  // Note: status updates are not supported via this endpoint
  // Use specific endpoints for job control: /retry, /delete
  priority: z.nativeEnum(JobPriority).optional(),
  metadata: z.object({}).passthrough().optional(),
});

export const PaginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

// Type inference from Zod schemas
export type JobCreateInput = z.infer<typeof JobCreateSchema>;
export type JobUpdateInput = z.infer<typeof JobUpdateSchema>;
export type PaginationInput = z.infer<typeof PaginationSchema>;
