import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import type { Job } from 'bullmq';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { appConfig } from '../../config/index.js';
import { transcriptionQueue } from '../../services/queue.js';
import {
  type ApiResponse,
  HealthStatus,
  JobCreateSchema,
  JobPriority,
  JobStatus,
  JobUpdateSchema,
  type PaginatedResponse,
  PaginationSchema,
  type TranscriptionJob,
} from '../../types/index.js';
import { getMimeType } from '../../utils/file.js';
import { atomicMove } from '../../utils/file-operations.js';

// ... (createJob remains the same)

/**
 * Compute health status dynamically based on job state
 */
async function computeHealthStatus(job: Job): Promise<HealthStatus> {
  const state = await job.getState();

  // Check if job is stalled (processing for too long without progress)
  const now = Date.now();
  const processingTime = job.processedOn ? now - job.processedOn : 0;
  const isStalled = state === 'active' && processingTime > appConfig.processing.stalledInterval;

  if (isStalled) {
    return HealthStatus.Stalled;
  }

  // Check if job recovered from failure
  const wasRecovered = job.attemptsMade > 0 && state === 'completed';
  if (wasRecovered) {
    return HealthStatus.Recovered;
  }

  // Normal healthy state (including prioritized in BullMQ 5)
  if (
    state === 'completed' ||
    state === 'active' ||
    state === 'waiting' ||
    state === 'delayed' ||
    state === 'prioritized'
  ) {
    return HealthStatus.Healthy;
  }

  // Unknown for other states
  return HealthStatus.Unknown;
}

export async function createJob(
  request: FastifyRequest<{ Body: { filePath: string; priority?: JobPriority; metadata?: any } }>,
  reply: FastifyReply
) {
  // Validate request body
  const validated = JobCreateSchema.parse(request.body);

  // Extract file information
  const filePath: string = validated.filePath;
  const fileName: string = basename(filePath);
  const fileExtension: string = extname(fileName).slice(1).toLowerCase() || 'unknown';

  // Get actual file size
  let fileSize: number;
  try {
    const stats = await stat(filePath);
    fileSize = stats.size;
  } catch (_err) {
    return reply.code(400).send({
      success: false,
      error: 'File not found or inaccessible',
      timestamp: new Date().toISOString(),
      requestId: request.id,
    });
  }

  // Create job data
  const jobData: Partial<TranscriptionJob> = {
    id: randomUUID(),
    fileName,
    filePath,
    fileSize,
    mimeType: getMimeType(fileExtension),
    status: JobStatus.PENDING,
    priority: validated.priority || JobPriority.NORMAL,
    progress: 0,
    createdAt: new Date(),
    attempts: 0,
    maxAttempts: 3,
    metadata: {
      originalPath: filePath,
      audioFormat: fileExtension,
      whisperModel: validated.metadata?.whisperModel || 'small',
      ...(validated.metadata?.language && { language: validated.metadata.language }),
    },
  };

  // Add job to queue
  const job = await transcriptionQueue.addJob(jobData);

  const response: ApiResponse = {
    success: true,
    data: {
      jobId: job.id,
      fileName: jobData.fileName,
      status: jobData.status,
      priority: jobData.priority,
      createdAt: jobData.createdAt,
    },
    timestamp: new Date().toISOString(),
    requestId: request.id,
  };

  reply.code(201);
  return response;
}

async function mapJobToResponse(job: Job) {
  const state = await job.getState();
  const healthStatus = await computeHealthStatus(job);
  let jobStatus = 'pending';

  if (state === 'completed') {
    jobStatus = 'completed';
  } else if (state === 'failed') {
    jobStatus = 'failed';
  } else if (state === 'active') {
    jobStatus = 'processing';
  }

  return {
    jobId: job.id,
    fileName: job.data.fileName,
    status: jobStatus,
    priority: job.data.priority,
    progress: job.progress || 0,
    createdAt: job.data.createdAt || new Date(job.timestamp).toISOString(),
    startedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
    completedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    attempts: job.attemptsMade,
    error: job.failedReason || null,
    fileSize: job.data.fileSize || null,
    healthStatus,
  };
}

export async function getAllJobs(
  request: FastifyRequest<{ Querystring: { page?: number; limit?: number; status?: JobStatus } }>,
  _reply: FastifyReply
) {
  const { page = 1, limit = 20, status } = request.query;
  const validated = PaginationSchema.parse({ page, limit });

  let jobs = [];
  let total = 0;

  if (status) {
    // Get jobs by status
    const start = (validated.page - 1) * validated.limit;
    const end = start + validated.limit - 1;
    jobs = await transcriptionQueue.getJobs(status, start, end);
    // Map JobStatus to BullMQ job types
    const statusMap = {
      [JobStatus.PENDING]: ['waiting', 'prioritized', 'delayed'], // BullMQ 5: prioritized stored separately
      [JobStatus.PROCESSING]: 'active',
      [JobStatus.COMPLETED]: 'completed',
      [JobStatus.FAILED]: 'failed',
      [JobStatus.CANCELLED]: 'failed',
      [JobStatus.RETRYING]: 'waiting',
    } as const;

    const bullStatus = statusMap[status];
    // getJobCountByTypes accepts array of statuses
    total = await transcriptionQueue.queueInstance.getJobCountByTypes(
      ...(Array.isArray(bullStatus) ? bullStatus : [bullStatus])
    );
  } else {
    // Get all jobs (combined from all statuses)
    // Use getJobCounts() for accurate pagination total (Story 2.3 requirement)
    const counts = await transcriptionQueue.getJobCounts();
    total = counts.total;

    const start = (validated.page - 1) * validated.limit;
    const end = start + validated.limit - 1;
    jobs = await transcriptionQueue.getAllJobs(start, end);
  }

  const response: PaginatedResponse<any> = {
    success: true,
    data: await Promise.all(jobs.map(mapJobToResponse)),
    pagination: {
      page: validated.page,
      limit: validated.limit,
      total,
      totalPages: Math.ceil(total / validated.limit),
    },
    timestamp: new Date().toISOString(),
    requestId: request.id,
  };

  return response;
}

export async function getJob(request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) {
  const { jobId } = request.params;

  const job = await transcriptionQueue.getJob(jobId);

  if (!job) {
    reply.code(404);
    return {
      success: false,
      error: 'Job not found',
      timestamp: new Date().toISOString(),
      requestId: request.id,
    };
  }

  const state = await job.getState();
  const healthStatus = await computeHealthStatus(job);

  const response: ApiResponse = {
    success: true,
    data: {
      jobId: job.id,
      name: job.name,
      status: state,
      data: job.data,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      errorCode: job.data.errorCode || null,
      errorReason: job.data.errorReason || job.failedReason || null,
      healthStatus,
      stacktrace: job.stacktrace,
      returnvalue: job.returnvalue,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
      timestamp: job.timestamp,
    },
    timestamp: new Date().toISOString(),
    requestId: request.id,
  };

  return response;
}

export async function updateJob(
  request: FastifyRequest<{ Params: { jobId: string }; Body: { priority?: JobPriority; metadata?: any } }>,
  reply: FastifyReply
) {
  const { jobId } = request.params;
  const validated = JobUpdateSchema.parse(request.body);

  // Ensure job exists before proceeding
  const job = await transcriptionQueue.getJob(jobId);
  if (!job) {
    return reply.code(404).send({
      success: false,
      error: 'Job not found',
      timestamp: new Date().toISOString(),
      requestId: request.id,
    });
  }

  // Update job metadata if provided
  if (validated.metadata) {
    await job.updateData({
      ...job.data,
      metadata: {
        ...job.data.metadata,
        ...validated.metadata,
      },
    });
  }

  // Update job priority if provided
  let updatedJob = job;
  if (validated.priority) {
    try {
      updatedJob = await transcriptionQueue.updateJobPriority(jobId, validated.priority);
    } catch (error: any) {
      if (error.message.includes('not found')) {
        return reply.code(404).send({
          success: false,
          error: `Job with ID ${jobId} not found`,
          timestamp: new Date().toISOString(),
          requestId: request.id,
        });
      }
      if (error.message.includes('completed or failed')) {
        return reply.code(409).send({
          success: false,
          error: 'Cannot update priority for a job that is already completed or failed.',
          timestamp: new Date().toISOString(),
          requestId: request.id,
        });
      }
      request.log.error(error, `Failed to update priority for job ${jobId}`);
      return reply.code(500).send({
        success: false,
        error: 'Internal server error while updating job priority.',
        timestamp: new Date().toISOString(),
        requestId: request.id,
      });
    }
  } else {
    // If priority wasn't updated, refetch to get latest metadata
    const refetchedJob = await transcriptionQueue.getJob(jobId);
    if (refetchedJob) {
      updatedJob = refetchedJob;
    }
  }

  if (!updatedJob) {
    // This is unlikely, but a safeguard
    return reply.code(404).send({
      success: false,
      error: 'Job not found after update.',
      timestamp: new Date().toISOString(),
      requestId: request.id,
    });
  }

  const response: ApiResponse = {
    success: true,
    data: {
      jobId: updatedJob.id,
      name: updatedJob.name,
      data: updatedJob.data,
      progress: updatedJob.progress,
      attemptsMade: updatedJob.attemptsMade,
      failedReason: updatedJob.failedReason,
      stacktrace: updatedJob.stacktrace,
      returnvalue: updatedJob.returnvalue,
      finishedOn: updatedJob.finishedOn,
      processedOn: updatedJob.processedOn,
      timestamp: updatedJob.timestamp,
    },
    timestamp: new Date().toISOString(),
    requestId: request.id,
  };

  return response;
}

function getProjectFromMap(projectName: string, projectMap: Map<string, any>) {
  if (!projectMap.has(projectName)) {
    projectMap.set(projectName, {
      name: projectName,
      completed: 0,
      processing: 0,
      pending: 0,
      failed: 0,
      files: [],
    });
  }
  return projectMap.get(projectName);
}

function updateProjectStats(project: any, job: any, jobStatus: string) {
  // Count by status
  if (jobStatus === 'completed' || job.finishedOn) {
    project.completed++;
  } else if (jobStatus === 'processing' || job.processedOn) {
    project.processing++;
  } else if (jobStatus === 'failed' || job.failedReason) {
    project.failed++;
  } else {
    project.pending++;
  }

  // Add file info
  project.files.push({
    id: job.id,
    name: job.data.fileName || 'Unknown',
    status: jobStatus,
    progress: job.progress || 0,
    error: job.failedReason || null,
    startTime: job.processedOn ? new Date(job.processedOn).toISOString() : null,
    endTime: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
  });
}

function processProjectJob(job: any, projectMap: Map<string, any>) {
  const filePath = job.data.filePath || job.data.fileName || 'Unknown';
  const pathParts = filePath.split('/');
  const projectName = pathParts.length > 1 ? pathParts[pathParts.length - 2] : 'Root';

  const project = getProjectFromMap(projectName, projectMap);
  const jobStatus = job.data.status || (job.finishedOn ? 'completed' : job.processedOn ? 'processing' : 'pending');

  updateProjectStats(project, job, jobStatus);
}

export async function getProjects(request: FastifyRequest, _reply: FastifyReply) {
  // Get all jobs from different statuses
  const [pendingJobs, processingJobs, completedJobs, failedJobs] = await Promise.all([
    transcriptionQueue.getJobs(JobStatus.PENDING, 0, 1000),
    transcriptionQueue.getJobs(JobStatus.PROCESSING, 0, 1000),
    transcriptionQueue.getJobs(JobStatus.COMPLETED, 0, 1000),
    transcriptionQueue.getJobs(JobStatus.FAILED, 0, 1000),
  ]);

  // Group jobs by directory (project)
  const projectMap = new Map<string, any>();

  const allJobs = [...pendingJobs, ...processingJobs, ...completedJobs, ...failedJobs];

  allJobs.forEach((job) => {
    processProjectJob(job, projectMap);
  });

  const projects = Array.from(projectMap.values());

  const response = {
    success: true,
    projects,
    timestamp: new Date().toISOString(),
    requestId: request.id,
  };

  return response;
}

export async function deleteJob(request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) {
  const { jobId } = request.params;

  // Get job before deletion to access file paths
  const job = await transcriptionQueue.getJob(jobId);

  if (!job) {
    return reply.code(404).send({
      success: false,
      error: 'Job not found',
      timestamp: new Date().toISOString(),
      requestId: request.id,
    });
  }

  // Delete associated artifacts
  const artifactsDeleted: string[] = [];
  const artifactsFailed: string[] = [];

  // Delete audio file if it exists
  if (job.data.filePath) {
    try {
      await fs.unlink(job.data.filePath);
      artifactsDeleted.push(job.data.filePath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        // Only log if error is not "file not found"
        request.log.warn({ error, path: job.data.filePath }, 'Failed to delete audio file');
        artifactsFailed.push(job.data.filePath);
      }
    }
  }

  // Delete transcript file if it exists
  if (job.data.transcriptPath) {
    try {
      await fs.unlink(job.data.transcriptPath);
      artifactsDeleted.push(job.data.transcriptPath);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        request.log.warn({ error, path: job.data.transcriptPath }, 'Failed to delete transcript file');
        artifactsFailed.push(job.data.transcriptPath);
      }
    }
  }

  // Remove job from queue
  await transcriptionQueue.removeJob(jobId);

  const response: ApiResponse = {
    success: true,
    data: {
      jobId,
      message: 'Job deleted successfully',
      artifactsDeleted: artifactsDeleted.length,
      artifactsFailed: artifactsFailed.length,
      deletedPaths: artifactsDeleted,
    },
    timestamp: new Date().toISOString(),
    requestId: request.id,
  };

  return response;
}

export async function retryJob(request: FastifyRequest<{ Params: { jobId: string } }>, reply: FastifyReply) {
  const { jobId } = request.params;

  // First check if the job exists
  const job = await transcriptionQueue.getJob(jobId);
  if (!job) {
    return reply.code(404).send({
      success: false,
      error: `Job ${jobId} not found`,
      timestamp: new Date().toISOString(),
      requestId: request.id,
    });
  }

  // Check job state for idempotency and validation (Story 2.4)
  const state = await job.getState();

  // Idempotency: If job is already in a valid processing state, return success
  if (state === 'waiting' || state === 'active') {
    request.log.debug({ jobId, state }, 'Job is already in a valid state, skipping retry (idempotent)');
    return {
      success: true,
      data: {
        jobId,
        message: `Job is already ${state}, no retry needed`,
        state,
      },
      timestamp: new Date().toISOString(),
      requestId: request.id,
    };
  }

  // Prevent retry of completed jobs
  if (state === 'completed') {
    return reply.code(400).send({
      success: false,
      error: 'Cannot retry a completed job. Consider deleting and re-uploading the file instead.',
      timestamp: new Date().toISOString(),
      requestId: request.id,
    });
  }

  // Only proceed with retry for failed jobs
  if (state !== 'failed') {
    return reply.code(409).send({
      success: false,
      error: `Job ${jobId} cannot be retried. Current state: ${state}`,
      timestamp: new Date().toISOString(),
      requestId: request.id,
    });
  }

  // Check if the input file exists and recover if needed
  if (job.data.filePath) {
    try {
      await fs.access(job.data.filePath);
    } catch (_error) {
      // Try to recover from failed directory using atomicMove (Story 2.4)
      try {
        const relativePath = relative(appConfig.processing.watchDirectory, job.data.filePath);
        const failedPath = join(appConfig.processing.failedDirectory, relativePath);

        await fs.access(failedPath);

        // Move back to original location using atomicMove for cross-filesystem safety
        await atomicMove(failedPath, job.data.filePath);
        request.log.info(
          { jobId, from: failedPath, to: job.data.filePath },
          'Restored file from failed directory for retry'
        );
      } catch (_recoveryError) {
        return reply.code(400).send({
          success: false,
          error: `Input file not accessible: ${job.data.filePath}`,
          timestamp: new Date().toISOString(),
          requestId: request.id,
        });
      }
    }
  }

  try {
    // Clear error fields before retrying (Story 2.4 requirement)
    await job.updateData({
      ...job.data,
      errorCode: undefined,
      errorReason: undefined,
    });

    // Re-inject job into queue
    await transcriptionQueue.retryJob(jobId);

    const response: ApiResponse = {
      success: true,
      data: {
        jobId,
        message: 'Job retried successfully',
      },
      timestamp: new Date().toISOString(),
      requestId: request.id,
    };

    return response;
  } catch (error: any) {
    request.log.error({ error, jobId }, 'Failed to retry job');
    return reply.code(500).send({
      success: false,
      error: `Failed to retry job: ${error.message}`,
      timestamp: new Date().toISOString(),
      requestId: request.id,
    });
  }
}

export async function getQueueStats(request: FastifyRequest, _reply: FastifyReply) {
  const stats = await transcriptionQueue.getQueueStats();

  const response: ApiResponse = {
    success: true,
    data: stats,
    timestamp: new Date().toISOString(),
    requestId: request.id,
  };

  return response;
}

export async function cleanFailedJobs(request: FastifyRequest, _reply: FastifyReply) {
  // Get failed jobs count before cleaning
  const failedJobsBefore = await transcriptionQueue.getJobs(JobStatus.FAILED, 0, 1000);
  const countBefore = failedJobsBefore.length;

  // Clean the queue (removes old completed and failed jobs)
  await transcriptionQueue.cleanQueue(0); // 0 grace period = clean all

  // Get failed jobs count after cleaning
  const failedJobsAfter = await transcriptionQueue.getJobs(JobStatus.FAILED, 0, 1000);
  const countAfter = failedJobsAfter.length;

  const response: ApiResponse = {
    success: true,
    data: {
      message: 'Failed jobs cleaned successfully',
      failedJobsRemoved: countBefore - countAfter,
      failedJobsBefore: countBefore,
      failedJobsAfter: countAfter,
    },
    timestamp: new Date().toISOString(),
    requestId: request.id,
  };

  return response;
}
