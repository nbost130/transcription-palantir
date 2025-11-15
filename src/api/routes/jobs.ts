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
      // Get total count for pagination
      total = await transcriptionQueue.queueInstance.count();
    } else {
      // Get all jobs (combined from all statuses)
      const stats = await transcriptionQueue.getQueueStats();
      total = stats.total;

      // For now, just get waiting jobs
      const start = (validated.page - 1) * validated.limit;
      const end = start + validated.limit - 1;
      jobs = await transcriptionQueue.getJobs(JobStatus.PENDING, start, end);
    }

    const response: PaginatedResponse<any> = {
      success: true,
      data: jobs.map(job => ({
        jobId: job.id,
        fileName: job.data.fileName,
        status: job.data.status,
        priority: job.data.priority,
        progress: job.data.progress || 0,
        createdAt: job.data.createdAt,
        startedAt: job.data.startedAt,
        completedAt: job.data.completedAt,
        attempts: job.attemptsMade,
      })),
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
      description: 'Update a job (metadata only, use /retry or DELETE for status changes)',
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
            description: 'Note: Priority changes not supported after job creation',
          },
          metadata: { type: 'object' },
        },
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
    const validated = JobUpdateSchema.parse(request.body);

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

    // Update job data
    if (validated.metadata) {
      await job.updateData({
        ...job.data,
        metadata: {
          ...job.data.metadata,
          ...validated.metadata,
        },
      });
    }

    // TODO: Implement priority update
    // BullMQ doesn't support changing priority after job creation

    const response: ApiResponse = {
      success: true,
      data: {
        jobId: job.id,
        message: 'Job updated successfully',
      },
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
  });

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
}
