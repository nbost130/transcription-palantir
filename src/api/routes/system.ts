/**
 * 🔮 Transcription Palantir - System Routes
 *
 * API endpoints for system information and configuration
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { appConfig } from '../../config/index.js';
import { whisperService } from '../../services/whisper.js';
import { logger } from '../../utils/logger.js';

// =============================================================================
// SYSTEM ROUTES
// =============================================================================

export async function systemRoutes(fastify: FastifyInstance): Promise<void> {
  // ---------------------------------------------------------------------------
  // GET /system/info - Get system information
  // ---------------------------------------------------------------------------
  fastify.get(
    '/system/info',
    {
      schema: {
        tags: ['system'],
        summary: 'Get system information',
        description: 'Returns comprehensive system information including Whisper.cpp status',
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  environment: { type: 'string' },
                  version: { type: 'string' },
                  uptime: { type: 'number' },
                  platform: { type: 'string' },
                  nodeVersion: { type: 'string' },
                  whisper: { type: 'object' },
                  config: { type: 'object' },
                },
              },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const whisperInfo = await whisperService.getSystemInfo();

        return {
          success: true,
          data: {
            environment: appConfig.env,
            version: process.env.npm_package_version || '1.0.0',
            uptime: process.uptime(),
            platform: process.platform,
            nodeVersion: process.version,
            whisper: whisperInfo,
            config: {
              port: appConfig.port,
              redis: {
                host: appConfig.redis.host,
                port: appConfig.redis.port,
              },
              processing: {
                maxWorkers: appConfig.processing.maxWorkers,
                supportedFormats: appConfig.processing.supportedFormats,
                maxFileSize: appConfig.processing.maxFileSize,
              },
            },
          },
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        logger.error({ error }, 'Failed to get system info');
        return reply.code(500).send({
          success: false,
          error: 'Failed to retrieve system information',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // GET /system/whisper - Get Whisper.cpp information
  // ---------------------------------------------------------------------------
  fastify.get(
    '/system/whisper',
    {
      schema: {
        tags: ['system'],
        summary: 'Get Whisper.cpp information',
        description: 'Returns detailed information about Whisper.cpp installation and models',
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  binaryPath: { type: 'string' },
                  binaryExists: { type: 'boolean' },
                  modelsPath: { type: 'string' },
                  installedModels: { type: 'array', items: { type: 'string' } },
                  availableModels: { type: 'array', items: { type: 'string' } },
                  currentModel: { type: 'string' },
                  status: { type: 'string' },
                },
              },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const whisperInfo = await whisperService.getSystemInfo();

        let status = 'ready';
        if (!whisperInfo.binaryExists) {
          status = 'binary_not_found';
        } else if (whisperInfo.installedModels.length === 0) {
          status = 'no_models_installed';
        } else if (!whisperInfo.installedModels.includes(appConfig.whisper.model)) {
          status = 'configured_model_missing';
        }

        return {
          success: true,
          data: {
            ...whisperInfo,
            currentModel: appConfig.whisper.model,
            status,
          },
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        logger.error({ error }, 'Failed to get Whisper info');
        return reply.code(500).send({
          success: false,
          error: 'Failed to retrieve Whisper information',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // GET /system/whisper/model/:modelName/install - Get install instructions
  // ---------------------------------------------------------------------------
  fastify.get<{
    Params: { modelName: string };
  }>(
    '/system/whisper/model/:modelName/install',
    {
      schema: {
        tags: ['system'],
        summary: 'Get model installation instructions',
        description: 'Returns instructions for downloading and installing a Whisper model',
        params: {
          type: 'object',
          properties: {
            modelName: {
              type: 'string',
              enum: ['tiny', 'base', 'small', 'medium', 'large'],
            },
          },
          required: ['modelName'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  modelName: { type: 'string' },
                  instructions: { type: 'string' },
                  alreadyInstalled: { type: 'boolean' },
                },
              },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { modelName: string } }>, reply: FastifyReply) => {
      const { modelName } = request.params;

      try {
        const isInstalled = await whisperService.validateModel(modelName);
        const instructions = whisperService.getModelDownloadInstructions(modelName);

        return {
          success: true,
          data: {
            modelName,
            instructions,
            alreadyInstalled: isInstalled,
          },
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        logger.error({ error, modelName }, 'Failed to get model install instructions');
        return reply.code(500).send({
          success: false,
          error: 'Failed to retrieve installation instructions',
          timestamp: new Date().toISOString(),
        });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // GET /system/config - Get configuration (without secrets)
  // ---------------------------------------------------------------------------
  fastify.get(
    '/system/config',
    {
      schema: {
        tags: ['system'],
        summary: 'Get system configuration',
        description: 'Returns current system configuration (without sensitive data)',
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return {
        success: true,
        data: {
          env: appConfig.env,
          port: appConfig.port,
          logLevel: appConfig.logLevel,
          redis: {
            host: appConfig.redis.host,
            port: appConfig.redis.port,
            db: appConfig.redis.db,
            // password is excluded
          },
          whisper: {
            model: appConfig.whisper.model,
            binaryPath: appConfig.whisper.binaryPath,
            computeType: appConfig.whisper.computeType,
            language: appConfig.whisper.language,
            task: appConfig.whisper.task,
          },
          processing: {
            watchDirectory: appConfig.processing.watchDirectory,
            outputDirectory: appConfig.processing.outputDirectory,
            completedDirectory: appConfig.processing.completedDirectory,
            failedDirectory: appConfig.processing.failedDirectory,
            maxFileSize: appConfig.processing.maxFileSize,
            minFileSize: appConfig.processing.minFileSize,
            supportedFormats: appConfig.processing.supportedFormats,
            maxWorkers: appConfig.processing.maxWorkers,
            minWorkers: appConfig.processing.minWorkers,
            jobTimeout: appConfig.processing.jobTimeout,
            maxAttempts: appConfig.processing.maxAttempts,
          },
          api: {
            prefix: appConfig.api.prefix,
            corsOrigin: appConfig.api.corsOrigin,
            rateLimitMax: appConfig.api.rateLimitMax,
            rateLimitWindow: appConfig.api.rateLimitWindow,
            // apiKey and jwtSecret are excluded
          },
          monitoring: {
            healthCheckInterval: appConfig.monitoring.healthCheckInterval,
            metricsEnabled: appConfig.monitoring.metricsEnabled,
            prometheusPort: appConfig.monitoring.prometheusPort,
          },
        },
        timestamp: new Date().toISOString(),
      };
    }
  );
}
