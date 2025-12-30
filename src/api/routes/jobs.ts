/**
 * 🔮 Transcription Palantir - Job Management Routes
 *
 * CRUD operations for transcription jobs
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { stat } from 'fs/promises';
import { basename, extname } from 'path';
import { transcriptionQueue } from '../../services/queue.js';
import {
  JobCreateSchema,
  JobUpdateSchema,
  PaginationSchema,
  JobStatus,
  JobPriority,
  type TranscriptionJob,
  type ApiResponse,
  type PaginatedResponse,
} from '../../types/index.js';
import { randomUUID } from 'crypto';
import { getMimeType } from '../../utils/file.js';

// =============================================================================
// JOB ROUTES
// =============================================================================

export async function jobRoutes(
  fastify: FastifyInstance,
  opts: FastifyPluginOptions
): Promise<void> {

  // ---------------------------------------------------------------------------
  // Create Job
  // ---------------------------------------------------------------------------

  fastify.post<{
    Body: { filePath: string; priority?: JobPriority; metadata?: any };
  }>('/jobs', {
    schema: {
      description: 'Create a new transcription job',
      tags: ['jobs'],
      body: {
        type: 'object',
        required: ['filePath'],
        properties: {
          filePath: { type: 'string', description: 'Path to the audio file' },
          priority: {
            type: 'number',
            enum: [1, 2, 3, 4],
            description: 'Job priority (1=URGENT, 2=HIGH, 3=NORMAL, 4=LOW)',
          },
          metadata: {
            type: 'object',
            description: 'Additional job metadata',
          },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object' },
            timestamp: { type: 'string' },
            requestId: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
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
    } catch (err) {
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
  });

  // ---------------------------------------------------------------------------
  // Get All Jobs
  // ---------------------------------------------------------------------------

  fastify.get<{
    Querystring: { page?: number; limit?: number; status?: JobStatus };
  }>('/jobs', {
    schema: {
      description: 'Get all jobs with pagination',
      tags: ['jobs'],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', minimum: 1, default: 1 },
          limit: { type: 'number', minimum: 1, maximum: 100, default: 20 },
          status: {
            type: 'string',
            enum: Object.values(JobStatus),
            description: 'Filter by job status',
          },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array' },
            pagination: { type: 'object' },
            timestamp: { type: 'string' },
            requestId: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
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
        [JobStatus.PENDING]: 'waiting',
        [JobStatus.PROCESSING]: 'active',
        [JobStatus.COMPLETED]: 'completed',
        [JobStatus.FAILED]: 'failed',
        [JobStatus.CANCELLED]: 'failed',
        [JobStatus.RETRYING]: 'waiting',
      } as const;

      const bullStatus = statusMap[status];
      total = await transcriptionQueue.queueInstance.getJobCountByTypes(bullStatus);
    } else {
      // Get all jobs (combined from all statuses)
      const stats = await transcriptionQueue.getQueueStats();
      total = stats.total;

      const start = (validated.page - 1) * validated.limit;
      const end = start + validated.limit - 1;
      jobs = await transcriptionQueue.getAllJobs(start, end);
    }

    const response: PaginatedResponse<any> = {
      success: true,
      data: jobs.map(job => {
        // Derive status from BullMQ job state
        let jobStatus = 'pending';
        if (job.finishedOn) {
          jobStatus = job.failedReason ? 'failed' : 'completed';
        } else if (job.processedOn && !job.finishedOn) {
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
        };
      }),
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
  });

  // ---------------------------------------------------------------------------
  // Get Single Job
  // ---------------------------------------------------------------------------

  fastify.get<{
    Params: { jobId: string };
  }>('/jobs/:jobId', {
    schema: {
      description: 'Get a specific job by ID',
      tags: ['jobs'],
      params: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'Job ID' },
        },
        required: ['jobId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object' },
            timestamp: { type: 'string' },
            requestId: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            timestamp: { type: 'string' },
            requestId: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
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

    const response: ApiResponse = {
      success: true,
      data: {
        jobId: job.id,
        name: job.name,
        data: job.data,
        progress: job.progress,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
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
  });

  // ---------------------------------------------------------------------------
  // Update Job
  // ---------------------------------------------------------------------------

  fastify.patch<{
    Params: { jobId: string };
    Body: { priority?: JobPriority; metadata?: any };
  }>('/jobs/:jobId', {
    schema: {
      description: 'Update an existing job (priority and/or metadata).',
      tags: ['jobs'],
      params: {
        type: 'object',
        properties: {
          jobId: { type: 'string' },
        },
        required: ['jobId'],
      },
      body: {
        type: 'object',
        properties: {
          priority: {
            type: 'number',
            enum: [1, 2, 3, 4],
            description: 'Update job priority. Cannot be updated if job is completed or failed.',
          },
          metadata: { type: 'object' },
        },
      },
      response: {
        200: {
          description: 'Job updated successfully.',
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object' },
            timestamp: { type: 'string' },
            requestId: { type: 'string' },
          },
        },
        404: {
          description: 'Job not found.',
          type: 'object',
          properties: {
            success: { type: 'boolean', default: false },
            error: { type: 'string' },
            timestamp: { type: 'string' },
            requestId: { type: 'string' },
          },
        },
        409: {
          description: 'Conflict, e.g., trying to update a completed job.',
          type: 'object',
          properties: {
            success: { type: 'boolean', default: false },
            error: { type: 'string' },
            timestamp: { type: 'string' },
            requestId: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
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
        fastify.log.error(error, `Failed to update priority for job ${jobId}`);
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
  });

  // ---------------------------------------------------------------------------
  // Get Projects (Dashboard Compatibility)
  // ---------------------------------------------------------------------------

  fastify.get('/projects', {
    schema: {
      description: 'Get projects grouped by directory for dashboard compatibility',
      tags: ['jobs'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            projects: { type: 'array' },
            timestamp: { type: 'string' },
            requestId: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
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

    allJobs.forEach(job => {
      const filePath = job.data.filePath || job.data.fileName || 'Unknown';
      const pathParts = filePath.split('/');
      const projectName = pathParts.length > 1 ? pathParts[pathParts.length - 2] : 'Root';

      if (!projectMap.has(projectName)) {
        projectMap.set(projectName, {
          name: projectName,
          completed: 0,
          processing: 0,
          pending: 0,
          failed: 0,
          files: []
        });
      }

      const project = projectMap.get(projectName);
      const jobStatus = job.data.status || (job.finishedOn ? 'completed' : job.processedOn ? 'processing' : 'pending');

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
    });

    const projects = Array.from(projectMap.values());

    const response = {
      success: true,
      projects,
      timestamp: new Date().toISOString(),
      requestId: request.id,
    };

    return response;
  });

  // ---------------------------------------------------------------------------
  // Delete Job
  // ---------------------------------------------------------------------------

  fastify.delete<{
    Params: { jobId: string };
  }>('/jobs/:jobId', {
    schema: {
      description: 'Delete a job',
      tags: ['jobs'],
      params: {
        type: 'object',
        properties: {
          jobId: { type: 'string' },
        },
        required: ['jobId'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object' },
            timestamp: { type: 'string' },
            requestId: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { jobId } = request.params;

    await transcriptionQueue.removeJob(jobId);

    const response: ApiResponse = {
      success: true,
      data: {
        jobId,
        message: 'Job deleted successfully',
      },
      timestamp: new Date().toISOString(),
      requestId: request.id,
    };

    return response;
  });

  // ---------------------------------------------------------------------------
  // Retry Job
  // ---------------------------------------------------------------------------

  fastify.post<{
    Params: { jobId: string };
  }>('/jobs/:jobId/retry', {
    schema: {
      description: 'Retry a failed job',
      tags: ['jobs'],
      params: {
        type: 'object',
        properties: {
          jobId: { type: 'string' },
        },
        required: ['jobId'],
      },
      body: {
        type: 'object',
        additionalProperties: false,
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object' },
            timestamp: { type: 'string' },
            requestId: { type: 'string' },
          },
          404: {
            description: 'Job not found.',
            type: 'object',
            properties: {
              success: { type: 'boolean', default: false },
              error: { type: 'string' },
              timestamp: { type: 'string' },
              requestId: { type: 'string' },
            },
          },
          409: {
            description: 'Job is not in the failed state.',
            type: 'object',
            properties: {
              success: { type: 'boolean', default: false },
              error: { type: 'string' },
              timestamp: { type: 'string' },
              requestId: { type: 'string' },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
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

    // Check if the job is in a failed state
    const state = await job.getState();
    if (state !== 'failed') {
      return reply.code(409).send({
        success: false,
        error: `Job ${jobId} is not in the failed state. Current state: ${state}`,
        timestamp: new Date().toISOString(),
        requestId: request.id,
      });
    }

    try {
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
      fastify.log.error({ error, jobId }, 'Failed to retry job');
      return reply.code(500).send({
        success: false,
        error: `Failed to retry job: ${error.message}`,
        timestamp: new Date().toISOString(),
        requestId: request.id,
      });
    }
  }
  );

  // ---------------------------------------------------------------------------
  // Get Queue Statistics
  // ---------------------------------------------------------------------------

  fastify.get('/queue/stats', {
    schema: {
      description: 'Get queue statistics',
      tags: ['queue'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object' },
            timestamp: { type: 'string' },
            requestId: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const stats = await transcriptionQueue.getQueueStats();

    const response: ApiResponse = {
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
      requestId: request.id,
    };

    return response;
  });

  // ---------------------------------------------------------------------------
  // Clean Failed Jobs
  // ---------------------------------------------------------------------------

  fastify.post('/queue/clean-failed', {
    schema: {
      description: 'Clean failed jobs from queue history',
      body: {
        type: 'object',
        additionalProperties: false,
      },
      tags: ['queue'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object' },
            timestamp: { type: 'string' },
            requestId: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
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
  });
}
