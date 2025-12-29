/**
 * 🔮 Enhanced Transcription Service
 *
 * Integrates our BullMQ + Whisper system with existing unified API
 * Maintains backward compatibility with existing routes and dashboard
 */

import type { Job } from 'bullmq';
import { TranscriptionQueue } from '../services/queue.js';
import { JobStatus, type TranscriptionJob } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { TranscriptionWorker } from '../workers/transcription-worker.js';

// Types matching existing API format
interface ProjectsResponse {
  projects: ProjectInfo[];
  timestamp: string;
}

interface ProjectInfo {
  name: string;
  totalFiles: number;
  completed: number;
  processing: number;
  pending: number;
  failed: number;
  files: FileInfo[];
}

interface FileInfo {
  id: string;
  fileName: string;
  filePath: string;
  status: string;
  progress?: number | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  error?: string | undefined;
}

interface RetryResponse {
  status: 'success' | 'error';
  message: string;
  jobId: string;
  timestamp: string;
}

interface JobResponse {
  id: string;
  fileName: string;
  filePath: string;
  status: string;
  progress?: number | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  error?: string | undefined;
  timestamp: string;
}

export class EnhancedTranscriptionService {
  private queue: TranscriptionQueue;
  private worker: TranscriptionWorker;
  private isInitialized = false;

  constructor() {
    this.queue = new TranscriptionQueue();
    this.worker = new TranscriptionWorker();
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      await this.queue.initialize();
      await this.worker.start();
      this.isInitialized = true;
      logger.info('Enhanced transcription service initialized');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize enhanced transcription service');
      throw error;
    }
  }

  /**
   * Get transcription projects grouped by folder
   * Maps our BullMQ jobs to existing API format
   */
  async getTranscriptionProjects(): Promise<ProjectsResponse> {
    try {
      await this.ensureInitialized();

      // Get all jobs from our queue
      const allJobs = await this.queue.getAllJobs();

      // Group jobs by project (extract folder name from file path)
      const projectMap = new Map<string, ProjectInfo>();

      for (const job of allJobs) {
        const projectName = this.extractProjectName(job.data.fileName, job.data.inputPath);

        if (!projectMap.has(projectName)) {
          projectMap.set(projectName, {
            name: projectName,
            totalFiles: 0,
            completed: 0,
            processing: 0,
            pending: 0,
            failed: 0,
            files: [],
          });
        }

        const project = projectMap.get(projectName)!;
        project.totalFiles++;

        // Map our job status to existing API status
        const apiStatus = this.mapJobStatusToApi(job);
        switch (apiStatus) {
          case 'completed':
            project.completed++;
            break;
          case 'processing':
            project.processing++;
            break;
          case 'pending':
            project.pending++;
            break;
          case 'failed':
            project.failed++;
            break;
        }

        // Add file info
        project.files.push(this.mapJobToFileInfo(job));
      }

      return {
        projects: Array.from(projectMap.values()),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get transcription projects');
      throw new Error(`Failed to get transcription projects: ${error}`);
    }
  }

  /**
   * Retry a failed transcription job
   * Uses our BullMQ retry mechanism
   */
  async retryTranscriptionJob(jobId: string): Promise<RetryResponse> {
    try {
      await this.ensureInitialized();

      const job = await this.queue.getJob(jobId);
      if (!job) {
        return {
          status: 'error',
          message: 'Job not found',
          jobId,
          timestamp: new Date().toISOString(),
        };
      }

      // Retry the job using BullMQ
      await job.retry();

      logger.info({ jobId }, 'Job retried successfully');

      return {
        status: 'success',
        message: 'Job retried successfully',
        jobId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error({ error, jobId }, 'Failed to retry job');
      return {
        status: 'error',
        message: `Failed to retry job: ${error}`,
        jobId,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Get dashboard data directly from Redis (bypasses SQLite)
   * This replaces the old getTranscriptionDashboard method
   */
  async getTranscriptionDashboard(): Promise<{ recentJobs: any[]; orbisJobs: any[] }> {
    try {
      await this.ensureInitialized();

      // Get all jobs from Redis BullMQ
      const allJobs = await this.queue.getAllJobs();

      // Get active jobs to properly distinguish processing vs pending
      const activeJobs = await this.queue.getJobs(JobStatus.PROCESSING, 0, 100);
      const activeJobIds = new Set(activeJobs.map((job) => job.id).filter((id): id is string => id !== undefined));

      // Map to dashboard format with proper status mapping
      const dashboardJobs = allJobs.map((job) => this.mapJobToDashboardFormat(job, activeJobIds));

      // Separate recent jobs and Orbis jobs
      const recentJobs = dashboardJobs.slice(0, 100); // Limit recent jobs
      const orbisJobs = dashboardJobs.filter(
        (job) => job.filePath?.includes('Orbis') || job.fileName?.includes('LESSON') || job.fileName?.includes('Orbis')
      );

      return { recentJobs, orbisJobs };
    } catch (error) {
      logger.error({ error }, 'Failed to get dashboard data from Redis');
      return { recentJobs: [], orbisJobs: [] };
    }
  }

  private mapJobToDashboardFormat(job: Job, activeJobIds: Set<string>): any {
    const status = this.mapJobStatusToDashboard(job, activeJobIds);
    const now = Date.now();

    // Calculate elapsed time since job creation
    const elapsedSeconds = Math.floor((now - job.timestamp) / 1000);

    // Calculate processing time (if job has started)
    let processingSeconds: number | undefined;
    if (job.processedOn) {
      if (job.finishedOn) {
        // Job finished - calculate total processing time
        processingSeconds = Math.floor((job.finishedOn - job.processedOn) / 1000);
      } else if (status === 'processing') {
        // Job still processing - calculate current processing time
        processingSeconds = Math.floor((now - job.processedOn) / 1000);
      }
    }

    return {
      id: job.id!,
      fileName: job.data.fileName,
      filePath: job.data.inputPath,
      status,
      createdAt: new Date(job.timestamp).toISOString(),
      startedAt: job.processedOn ? new Date(job.processedOn).toISOString() : undefined,
      completedAt: job.finishedOn && status === 'completed' ? new Date(job.finishedOn).toISOString() : undefined,
      error: job.failedReason || '',
      fileSize: job.data.fileSize,
      outputPath: job.data.outputPath,
      elapsedSeconds,
      processingSeconds,
    };
  }

  private mapJobStatusToDashboard(job: Job, activeJobIds: Set<string>): string {
    // Check if job is finished first
    if (job.finishedOn) {
      if (job.failedReason) return 'failed';
      return 'completed';
    }

    // Check if job is actively being processed (in active queue)
    if (activeJobIds.has(job.id!)) {
      return 'processing';
    }

    // Otherwise it's waiting to be processed (pending)
    return 'pending';
  }

  /**
   * Get specific job details
   * Maps our BullMQ job to existing API format
   */
  async getTranscriptionJob(jobId: string): Promise<JobResponse> {
    try {
      await this.ensureInitialized();

      const job = await this.queue.getJob(jobId);
      if (!job) {
        throw new Error('Job not found');
      }

      return this.mapJobToApiResponse(job);
    } catch (error) {
      logger.error({ error, jobId }, 'Failed to get job details');
      throw new Error(`Failed to get job details: ${error}`);
    }
  }

  // Private helper methods
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  private extractProjectName(fileName: string, filePath?: string): string {
    if (filePath) {
      const pathParts = filePath.split('/');
      // Extract meaningful folder name from path
      if (pathParts.length > 2) {
        return pathParts[pathParts.length - 2] || 'Unknown Project';
      }
    }

    // Fallback to extracting from filename
    const parts = fileName.split('_');
    return parts[0] || 'Unknown Project';
  }

  private mapJobStatusToApi(job: Job): string {
    switch (
      job.opts?.attempts && job.attemptsMade >= job.opts.attempts
        ? 'failed'
        : job.finishedOn
          ? 'completed'
          : job.processedOn
            ? 'processing'
            : 'pending'
    ) {
      case 'completed':
        return 'completed';
      case 'processing':
        return 'processing';
      case 'failed':
        return 'failed';
      default:
        return 'pending';
    }
  }

  private mapJobToFileInfo(job: Job): FileInfo {
    return {
      id: job.id!,
      fileName: job.data.fileName,
      filePath: job.data.inputPath,
      status: this.mapJobStatusToApi(job),
      progress: typeof job.progress === 'number' ? job.progress : undefined,
      startTime: job.processedOn ? new Date(job.processedOn).toISOString() : undefined,
      endTime: job.finishedOn ? new Date(job.finishedOn).toISOString() : undefined,
      error: job.failedReason || undefined,
    };
  }

  private mapJobToApiResponse(job: Job): JobResponse {
    return {
      id: job.id!,
      fileName: job.data.fileName,
      filePath: job.data.inputPath,
      status: this.mapJobStatusToApi(job),
      progress: typeof job.progress === 'number' ? job.progress : undefined,
      startTime: job.processedOn ? new Date(job.processedOn).toISOString() : undefined,
      endTime: job.finishedOn ? new Date(job.finishedOn).toISOString() : undefined,
      error: job.failedReason || undefined,
      timestamp: new Date().toISOString(),
    };
  }
}
