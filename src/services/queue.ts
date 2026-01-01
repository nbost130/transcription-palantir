/**
 * 🔮 Transcription Palantir - Queue Service
 *
 * BullMQ-based job queue management for transcription tasks
 */

import { type Job, Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { appConfig, getRedisUrl } from '../config/index.js';
import { JobPriority, JobStatus, type TranscriptionJob } from '../types/index.js';
import { logQueueEvent, queueLogger } from '../utils/logger.js';

// =============================================================================
// REDIS CONNECTION
// =============================================================================

/**
 * Create Redis connection with resilience configuration
 *
 * Features:
 * - Exponential backoff retry strategy
 * - Reconnect on transient errors (DNS, connection refused, timeout)
 * - Error event handling to prevent crashes
 * - Offline queue for commands during reconnection
 */
const redisConnection = new Redis(getRedisUrl(), {
  maxRetriesPerRequest: null, // Required for BullMQ
  lazyConnect: false, // Connect immediately
  connectTimeout: appConfig.redis.connectTimeout,
  enableOfflineQueue: appConfig.redis.enableOfflineQueue,

  /**
   * Retry strategy with exponential backoff
   * @param times - Number of reconnection attempts
   * @returns Delay in milliseconds before next retry, or null to stop retrying
   */
  retryStrategy(times: number): number | null {
    if (times > appConfig.redis.maxRetries) {
      queueLogger.error({ attempts: times }, 'Max Redis connection retries exceeded, giving up');
      return null; // Stop retrying
    }

    // Exponential backoff: min(times * 50, 2000)ms
    const delay = Math.min(times * 50, 2000);
    queueLogger.warn({ attempt: times, delayMs: delay }, 'Redis connection failed, retrying...');
    return delay;
  },

  /**
   * Reconnect on specific transient errors
   * @param err - Error from Redis
   * @returns true to reconnect, false to not reconnect
   */
  reconnectOnError(err: Error): boolean | 1 | 2 {
    if (!appConfig.redis.reconnectOnError) {
      return false;
    }

    // List of transient errors that should trigger reconnection
    const transientErrors = [
      'ECONNREFUSED', // Connection refused
      'ENOTFOUND', // DNS resolution failed
      'ETIMEDOUT', // Connection timeout
      'ECONNRESET', // Connection reset by peer
      'EPIPE', // Broken pipe
      'READONLY', // Redis in readonly mode (failover)
    ];

    const shouldReconnect = transientErrors.some((errCode) => err.message.includes(errCode));

    if (shouldReconnect) {
      queueLogger.warn({ error: err.message }, 'Transient Redis error detected, reconnecting...');
      return true; // Reconnect but don't resend failed command
    }

    return false;
  },
});

/**
 * Handle Redis connection errors gracefully
 * This prevents the application from crashing on connection issues
 */
redisConnection.on('error', (err: Error) => {
  queueLogger.error(
    { error: err.message, code: (err as any).code },
    'Redis connection error (will retry automatically)'
  );
});

/**
 * Log successful Redis connections
 */
redisConnection.on('connect', () => {
  queueLogger.info('Redis connection established');
});

/**
 * Log when Redis is ready to accept commands
 */
redisConnection.on('ready', () => {
  queueLogger.info('Redis connection ready');
});

/**
 * Log reconnection attempts
 */
redisConnection.on('reconnecting', (delay: number) => {
  queueLogger.info({ delayMs: delay }, 'Reconnecting to Redis...');
});

/**
 * Log when connection is closed
 */
redisConnection.on('close', () => {
  queueLogger.warn('Redis connection closed');
});

/**
 * Log when connection ends (no more reconnections)
 */
redisConnection.on('end', () => {
  queueLogger.error('Redis connection ended, no more reconnection attempts');
});

// =============================================================================
// QUEUE CONFIGURATION
// =============================================================================

const queueOptions = {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: false,
    removeOnFail: false,
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
  private queueEventsConnection: Redis;
  private isInitialized = false;

  constructor() {
    this.queue = new Queue('transcription', queueOptions);
    // Use a dedicated connection for QueueEvents to avoid blocking the main connection
    this.queueEventsConnection = redisConnection.duplicate();
    this.queueEvents = new QueueEvents('transcription', { connection: this.queueEventsConnection });
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
      if (this.queueEventsConnection.status !== 'end') {
        await this.queueEventsConnection.quit().catch((err) => {
          queueLogger.warn({ err }, 'Error quitting queue events connection');
        });
      }

      await this.queue.close();
      if (redisConnection.status !== 'end') {
        await redisConnection.quit().catch((err) => {
          queueLogger.warn({ err }, 'Error quitting main redis connection');
        });
      }

      this.isInitialized = false;
      queueLogger.info('Transcription queue closed successfully');
    } catch (error) {
      queueLogger.error({ error }, 'Error closing transcription queue');
      // Don't throw here, just log it, to allow tests to finish cleanup
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
      waiting: waiting?.length ?? 0,
      active: active?.length ?? 0,
      completed: completed?.length ?? 0,
      failed: failed?.length ?? 0,
      delayed: delayed?.length ?? 0,
      total: (waiting?.length ?? 0) + (active?.length ?? 0) + (completed?.length ?? 0) + (failed?.length ?? 0) + (delayed?.length ?? 0),
    };
  }

  /**
   * Get accurate job counts using BullMQ's native count methods
   * More efficient than fetching all jobs and counting
   */
  async getJobCounts() {
    const counts = await this.queue.getJobCounts(
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
      'paused'
    );

    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
      paused: counts.paused || 0,
      total,
    };
  }

  async getJobs(status: JobStatus, start = 0, end = 19) {
    if (status === JobStatus.PENDING) {
      // For pending jobs, we need to combine delayed and waiting queues
      // but respect the pagination limits
      const _limit = end - start + 1;

      // Get jobs from both queues with generous limits
      const [delayedJobs, waitingJobs] = await Promise.all([
        this.queue.getJobs(['delayed'], 0, Math.max(end * 2, 100)),
        this.queue.getJobs(['waiting'], 0, Math.max(end * 2, 100)),
      ]);

      // Combine and sort by timestamp (newer first)
      const combined = [...delayedJobs, ...waitingJobs].sort((a, b) => {
        const aTime = a.timestamp || 0;
        const bTime = b.timestamp || 0;
        return bTime - aTime;
      });

      // Apply pagination to the combined result
      return combined.slice(start, end + 1);
    }

    const statusMap = {
      [JobStatus.PROCESSING]: 'active',
      [JobStatus.COMPLETED]: 'completed',
      [JobStatus.FAILED]: 'failed',
      [JobStatus.CANCELLED]: 'failed',
      [JobStatus.RETRYING]: 'waiting',
    } as const;

    const bullStatus = statusMap[status as keyof typeof statusMap];
    return this.queue.getJobs([bullStatus], start, end);
  }

  async getAllJobs(start = 0, end = 100) {
    // Get jobs from all statuses
    // To ensure accurate global pagination by timestamp, we must fetch the top 'end' jobs
    // from EACH status, combine them, sort, and then take the requested slice.
    // Fetching from 'start' to 'end' per status is incorrect because the Nth job globally
    // might be the 1st job in a specific queue.
    const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
      this.queue.getJobs(['waiting'], 0, end),
      this.queue.getJobs(['active'], 0, end),
      this.queue.getJobs(['completed'], 0, end),
      this.queue.getJobs(['failed'], 0, end),
      this.queue.getJobs(['delayed'], 0, end),
      this.queue.getJobs(['paused'], 0, end),
    ]);

    // We sort by timestamp to try to give a somewhat consistent order
    const allJobs = [...waiting, ...active, ...completed, ...failed, ...delayed, ...paused];
    allJobs.sort((a, b) => b.timestamp - a.timestamp);

    // Now apply the global pagination slice
    // Note: The 'start' and 'end' arguments are 0-based indices.
    // However, since we fetched 0..end from each, our local array has plenty of data.
    // We just need to slice the correct window.
    // But wait, if we fetched 0..end from each, we have up to (end+1)*6 items.
    // The global 'start' index applies to this sorted list.
    // BUT, if 'start' is large (e.g. page 10), fetching 0..end (e.g. 0..100) is fine.
    // But if start > end (which shouldn't happen for a page), we need to be careful.
    // Actually, 'end' passed to this function is (page * limit) - 1.
    // So fetching 0..end covers everything up to the current page.

    // We need to return the slice corresponding to the requested page.
    // The caller (jobs.ts) calculates start/end based on page/limit.
    // e.g. Page 2, limit 10: start=10, end=19.
    // We fetched 0..19 from all queues.
    // So we have the top 20 from each.
    // We sort them. The global top 20 are definitely in this set.
    // We take slice(start, end + 1).

    // However, if the user requests start=10, end=19.
    // We fetched 0..19.
    // The slice should be relative to the global list.
    // Since we only fetched 0..end, the global list IS effectively 0..end (plus extras).
    // So slicing at 'start' is correct.

    return allJobs.slice(start, end + 1);
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

  async updateJobPriority(jobId: string, priority: JobPriority): Promise<Job> {
    const job = await this.getJob(jobId);

    if (!job) {
      throw new Error('Job not found');
    }

    const isFinished = (await job.isCompleted()) || (await job.isFailed());
    if (isFinished) {
      throw new Error('Cannot update priority of completed or failed jobs');
    }

    const oldPriority = job.data.priority;
    const isActive = await job.isActive();

    queueLogger.info(
      {
        jobId,
        oldPriority,
        newPriority: priority,
        isActive,
      },
      'Starting priority update'
    );

    if (isActive) {
      // For active (processing) jobs, just update the data priority
      // We can't change the priority of a job that's already being processed
      queueLogger.info({ jobId, oldPriority, newPriority: priority }, 'Job is active, updating data priority only');
      await job.updateData({ ...job.data, priority });
      queueLogger.info({ jobId, priority }, 'Data priority updated for active job');
    } else {
      // For ALL pending jobs (waiting, delayed, paused), use remove + re-add
      // BullMQ's changePriority() has issues with jobs that have been retried
      const newDelay = this.calculateDelay(priority);
      const jobData = { ...job.data, priority };

      queueLogger.info(
        { jobId, oldPriority, newPriority: priority, delay: newDelay },
        'Updating pending job priority (remove + re-add)'
      );

      // Remove the existing job first
      await job.remove();
      queueLogger.info({ jobId }, 'Job removed');

      // Add the job back with new priority and delay
      // BullMQ will generate a new job ID
      const newJob = await this.queue.add(job.name, jobData, {
        priority,
        delay: newDelay,
      });
      queueLogger.info(
        { oldJobId: jobId, newJobId: newJob.id, priority, delay: newDelay },
        'Job re-added with new priority'
      );

      // Update the jobId for the return value
      jobId = newJob.id!;
    }

    logQueueEvent('job_priority_updated', {
      jobId,
      oldPriority: oldPriority,
      newPriority: priority,
    });

    // The job object might be stale after these operations, so we refetch it
    // to return the truly updated state.
    const updatedJob = await this.getJob(jobId);
    if (!updatedJob) {
      throw new Error('Job not found after priority update');
    }

    return updatedJob;
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

// Export Redis connection for reuse by other services
export { redisConnection };
