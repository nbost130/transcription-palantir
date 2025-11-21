/**
 * 🔮 Enhanced Transcription Service
 * 
 * Integrates our BullMQ + Whisper system with existing unified API
 * Maintains backward compatibility with existing routes and dashboard
 */

import { TranscriptionQueue } from '../services/queue.js';
import { TranscriptionWorker } from '../workers/transcription-worker.js';
import { logger } from '../utils/logger.js';
import { JobStatus, type TranscriptionJob } from '../types/index.js';
import type { Job } from 'bullmq';

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
            files: []
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
        timestamp: new Date().toISOString()
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
          timestamp: new Date().toISOString()
        };
      }

      // Retry the job using BullMQ
      await job.retry();
      
      logger.info({ jobId }, 'Job retried successfully');
      
      return {
        status: 'success',
        message: 'Job retried successfully',
        jobId,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error({ error, jobId }, 'Failed to retry job');
      return {
        status: 'error',
        message: `Failed to retry job: ${error}`,
        jobId,
        timestamp: new Date().toISOString()
      };
    }
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
    switch (job.opts?.attempts && job.attemptsMade >= job.opts.attempts ? 'failed' : job.finishedOn ? 'completed' : job.processedOn ? 'processing' : 'pending') {
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
      error: job.failedReason || undefined
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
      timestamp: new Date().toISOString()
    };
  }
}
