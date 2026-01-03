/**
 * 🔮 Transcription Palantir - Job Management Routes
 *
 * CRUD operations for transcription jobs
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import * as jobsController from '../controllers/jobs.js';
import * as jobsSchemas from '../schemas/jobs.js';

// =============================================================================
// JOB ROUTES
// =============================================================================

export async function jobRoutes(fastify: FastifyInstance, _opts: FastifyPluginOptions): Promise<void> {
  // ---------------------------------------------------------------------------
  // Create Job
  // ---------------------------------------------------------------------------

  fastify.post(
    '/jobs',
    {
      schema: jobsSchemas.createJobSchema,
    },
    jobsController.createJob
  );

  // ---------------------------------------------------------------------------
  // Get All Jobs
  // ---------------------------------------------------------------------------

  fastify.get(
    '/jobs',
    {
      schema: jobsSchemas.getAllJobsSchema,
    },
    jobsController.getAllJobs
  );

  // ---------------------------------------------------------------------------
  // Get Single Job
  // ---------------------------------------------------------------------------

  fastify.get(
    '/jobs/:jobId',
    {
      schema: jobsSchemas.getJobSchema,
    },
    jobsController.getJob
  );

  // ---------------------------------------------------------------------------
  // Update Job
  // ---------------------------------------------------------------------------

  fastify.patch(
    '/jobs/:jobId',
    {
      schema: jobsSchemas.updateJobSchema,
    },
    jobsController.updateJob
  );

  // ---------------------------------------------------------------------------
  // Get Projects (Dashboard Compatibility)
  // ---------------------------------------------------------------------------

  fastify.get(
    '/projects',
    {
      schema: jobsSchemas.getProjectsSchema,
    },
    jobsController.getProjects
  );

  // ---------------------------------------------------------------------------
  // Delete Job
  // ---------------------------------------------------------------------------

  fastify.delete(
    '/jobs/:jobId',
    {
      schema: jobsSchemas.deleteJobSchema,
    },
    jobsController.deleteJob
  );

  // ---------------------------------------------------------------------------
  // Retry Job
  // ---------------------------------------------------------------------------

  fastify.post(
    '/jobs/:jobId/retry',
    {
      schema: jobsSchemas.retryJobSchema,
    },
    jobsController.retryJob
  );

  // ---------------------------------------------------------------------------
  // Get Queue Statistics
  // ---------------------------------------------------------------------------

  fastify.get(
    '/queue/stats',
    {
      schema: jobsSchemas.getQueueStatsSchema,
    },
    jobsController.getQueueStats
  );

  // ---------------------------------------------------------------------------
  // Clean Failed Jobs
  // ---------------------------------------------------------------------------

  fastify.post(
    '/queue/clean-failed',
    {
      schema: jobsSchemas.cleanFailedJobsSchema,
    },
    jobsController.cleanFailedJobs
  );

  // ---------------------------------------------------------------------------
  // Get Stuck Jobs
  // ---------------------------------------------------------------------------

  fastify.get(
    '/jobs/stuck',
    {
      schema: jobsSchemas.getStuckJobsSchema,
    },
    jobsController.getStuckJobs
  );
}
