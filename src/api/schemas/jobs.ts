import { JobStatus } from '../../types/index.js';

export const createJobSchema = {
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
        data: { type: 'object', additionalProperties: true },
        timestamp: { type: 'string' },
        requestId: { type: 'string' },
      },
    },
  },
};

export const getAllJobsSchema = {
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
        pagination: {
          type: 'object',
          properties: {
            page: { type: 'number' },
            limit: { type: 'number' },
            total: { type: 'number' },
            totalPages: { type: 'number' },
          },
        },
        timestamp: { type: 'string' },
        requestId: { type: 'string' },
      },
    },
  },
};

export const getJobSchema = {
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
};

export const updateJobSchema = {
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
};

export const getProjectsSchema = {
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
};

export const deleteJobSchema = {
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
};

export const retryJobSchema = {
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
    400: {
      description: 'Bad request (e.g., file not accessible).',
      type: 'object',
      properties: {
        success: { type: 'boolean', default: false },
        error: { type: 'string' },
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
};

export const getQueueStatsSchema = {
  description: 'Get queue statistics',
  tags: ['queue'],
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: { type: 'object', additionalProperties: true },
        timestamp: { type: 'string' },
        requestId: { type: 'string' },
      },
    },
  },
};

export const cleanFailedJobsSchema = {
  description: 'Clean failed jobs from queue history',
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
};
