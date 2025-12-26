/**
 * 🔮 Transcription Palantir - Queue Service
 *
 * BullMQ-based job queue management for transcription tasks
 */

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { appConfig, getRedisUrl } from '../config/index.js';
import { queueLogger, logQueueEvent } from '../utils/logger.js';
import { JobPriority, JobStatus, type TranscriptionJob } from '../types/index.js';

// =============================================================================
// REDIS CONNECTION
// =============================================================================

const redisConnection = new Redis(getRedisUrl(), {
  maxRetriesPerRequest: null, // Required for BullMQ
  lazyConnect: false, // Connect immediately
});

// =============================================================================
// QUEUE CONFIGURATION
// =============================================================================

const queueOptions = {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: appConfig.processing.maxAttempts,
    backoff: {
      type: 'exponential' as const,
      delay: 5000,
    },
    delay: 0,
  },
};

// =============================================================================
// TRANSCRIPTION QUEUE
// =============================================================================

export class TranscriptionQueue {
  private queue: Queue;
  private queueEvents: QueueEvents;
  private isInitialized = false;

  constructor() {
    this.queue = new Queue('transcription', queueOptions);
    this.queueEvents = new QueueEvents('transcription', { connection: redisConnection });
    this.setupEventListeners();
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      await this.queue.waitUntilReady();
      await this.queueEvents.waitUntilReady();

      this.isInitialized = true;
      queueLogger.info('Transcription queue initialized successfully');
    } catch (error) {
      queueLogger.error({ error }, 'Failed to initialize transcription queue');
      throw error;
    }
  }

  async close(): Promise<void> {
    if (!this.isInitialized) return;

    try {
      await this.queueEvents.close();
      await this.queue.close();
      await redisConnection.quit();

      this.isInitialized = false;
      queueLogger.info('Transcription queue closed successfully');
    } catch (error) {
      queueLogger.error({ error }, 'Error closing transcription queue');
      throw error;
    }
  }

  // ===========================================================================
  // JOB MANAGEMENT
  // ===========================================================================

  async addJob(jobData: Partial<TranscriptionJob>): Promise<Job> {
    if (!this.isInitialized) {
      throw new Error('Queue not initialized');
    }

    const job = await this.queue.add('transcribe', jobData, {
      priority: jobData.priority || JobPriority.NORMAL,
      ...(jobData.id && { jobId: jobData.id }),
      delay: this.calculateDelay(jobData.priority),
    });

    logQueueEvent('job_added', {
      jobId: job.id || undefined,
      fileName: jobData.fileName || undefined,
      priority: jobData.priority || undefined,
    });

    return job;
  }

  async getJob(jobId: string): Promise<Job | undefined> {
    return this.queue.getJob(jobId);
  }

  async removeJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (job) {
      await job.remove();
      logQueueEvent('job_removed', { jobId });
    }
  }

  async retryJob(jobId: string): Promise<void> {
    const job = await this.getJob(jobId);
    if (job) {
      await job.retry();
      logQueueEvent('job_retried', { jobId });
    }
  }

  // ===========================================================================
  // QUEUE STATISTICS
  // ===========================================================================

  async getQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaiting(),
      this.queue.getActive(),
      this.queue.getCompleted(),
      this.queue.getFailed(),
      this.queue.getDelayed(),
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
      total: waiting.length + active.length + completed.length + failed.length + delayed.length,
    };
  }

  async getJobs(status: JobStatus, start = 0, end = 19) {
    const statusMap = {
      [JobStatus.PENDING]: 'waiting',
      [JobStatus.PROCESSING]: 'active',
      [JobStatus.COMPLETED]: 'completed',
      [JobStatus.FAILED]: 'failed',
      [JobStatus.CANCELLED]: 'failed', // Map cancelled to failed for BullMQ
      [JobStatus.RETRYING]: 'waiting',
    } as const;

    const bullStatus = statusMap[status];
    return this.queue.getJobs([bullStatus], start, end);
  }

  async getAllJobs(start = 0, end = 100) {
    // Get jobs from all statuses
    const [waiting, active, completed, failed] = await Promise.all([
      this.queue.getJobs(['waiting'], start, end),
      this.queue.getJobs(['active'], start, end),
      this.queue.getJobs(['completed'], start, end),
      this.queue.getJobs(['failed'], start, end),
    ]);

    return [...waiting, ...active, ...completed, ...failed];
  }

  // ===========================================================================
  // QUEUE MANAGEMENT
  // ===========================================================================

  async pauseQueue(): Promise<void> {
    await this.queue.pause();
    queueLogger.info('Queue paused');
  }

  async resumeQueue(): Promise<void> {
    await this.queue.resume();
    queueLogger.info('Queue resumed');
  }

  async cleanQueue(grace = 5000): Promise<void> {
    await this.queue.clean(grace, 100, 'completed');
    await this.queue.clean(grace, 50, 'failed');
    queueLogger.info('Queue cleaned');
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  private calculateDelay(priority?: JobPriority): number {
    // Add small delays for lower priority jobs to allow urgent jobs to jump ahead
    switch (priority) {
      case JobPriority.URGENT:
        return 0;
      case JobPriority.HIGH:
        return 1000; // 1 second
      case JobPriority.NORMAL:
        return 5000; // 5 seconds
      case JobPriority.LOW:
        return 10000; // 10 seconds
      default:
        return 5000;
    }
  }

  private setupEventListeners(): void {
    this.queueEvents.on('completed', ({ jobId }) => {
      logQueueEvent('job_completed', { jobId });
    });

    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      logQueueEvent('job_failed', { jobId, error: failedReason });
    });

    this.queueEvents.on('active', ({ jobId }) => {
      logQueueEvent('job_active', { jobId });
    });

    this.queueEvents.on('stalled', async ({ jobId }) => {
      logQueueEvent('job_stalled', { jobId });
      await this.handleStalledJob(jobId);
    });

    this.queueEvents.on('progress', ({ jobId, data }) => {
      logQueueEvent('job_progress', { jobId, progress: data });
    });
  }

  private async handleStalledJob(jobId: string): Promise<void> {
    try {
      queueLogger.warn({ jobId }, 'Handling stalled job');

      const job = await this.getJob(jobId);
      if (job) {
        // BullMQ will automatically retry stalled jobs
        // We just log it for monitoring purposes
        queueLogger.info({ jobId }, 'Stalled job will be automatically retried by BullMQ');
      }
    } catch (error) {
      queueLogger.error({ error, jobId }, 'Error handling stalled job');
    }
  }

  // ===========================================================================
  // GETTERS
  // ===========================================================================

  get isReady(): boolean {
    return this.isInitialized;
  }

  get queueInstance(): Queue {
    return this.queue;
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const transcriptionQueue = new TranscriptionQueue();
