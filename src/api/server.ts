/**
 * 🔮 Transcription Palantir - API Server
 *
 * Fastify-based REST API for job management and monitoring
 */

import Fastify from 'fastify';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import { appConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { healthRoutes } from './routes/health.js';
import { jobRoutes } from './routes/jobs.js';
import { errorHandler } from './middleware/error.js';
import { requestLogger } from './middleware/logger.js';

// =============================================================================
// API SERVER CLASS
// =============================================================================

export class ApiServer {
  private app: FastifyInstance;
  private isRunning = false;

  constructor() {
    this.app = this.createServer();
  }

  // ===========================================================================
  // SERVER CREATION
  // ===========================================================================

  private createServer(): FastifyInstance {
    const opts: FastifyServerOptions = {
      logger: false, // Use custom Pino logger
      trustProxy: true,
      requestIdHeader: 'x-request-id',
      requestIdLogLabel: 'requestId',
      disableRequestLogging: true, // Use custom request logger
    };

    const fastify = Fastify(opts);

    // Register plugins
    this.registerPlugins(fastify);

    // Register middleware
    this.registerMiddleware(fastify);

    // Register routes
    this.registerRoutes(fastify);

    // Register error handler
    fastify.setErrorHandler(errorHandler);

    return fastify;
  }

  // ===========================================================================
  // PLUGIN REGISTRATION
  // ===========================================================================

  private registerPlugins(fastify: FastifyInstance): void {
    // CORS Configuration
    fastify.register(cors, {
      origin: appConfig.api.corsOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    });

    // Security Headers
    fastify.register(helmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      crossOriginEmbedderPolicy: false,
    });

    // Rate Limiting
    fastify.register(rateLimit, {
      max: appConfig.api.rateLimitMax,
      timeWindow: appConfig.api.rateLimitWindow,
      errorResponseBuilder: (req, context) => {
        return {
          success: false,
          error: 'Rate limit exceeded',
          retryAfter: context.after,
          timestamp: new Date().toISOString(),
        };
      },
    });

    // WebSocket Support
    fastify.register(websocket, {
      options: {
        maxPayload: 1024 * 1024, // 1MB
      },
    });

    // Swagger Documentation
    fastify.register(swagger, {
      openapi: {
        info: {
          title: 'Transcription Palantir API',
          description: 'Modern TypeScript transcription system with BullMQ, Redis, and Whisper.cpp',
          version: '1.0.0',
          contact: {
            name: 'Mithrandir System',
            url: 'https://github.com/nbost130/transcription-palantir',
          },
          license: {
            name: 'MIT',
            url: 'https://opensource.org/licenses/MIT',
          },
        },
        servers: [
          {
            url: `http://localhost:${appConfig.port}`,
            description: 'Development server',
          },
        ],
        tags: [
          { name: 'health', description: 'Health check endpoints' },
          { name: 'jobs', description: 'Job management endpoints' },
          { name: 'queue', description: 'Queue monitoring endpoints' },
          { name: 'workers', description: 'Worker management endpoints' },
        ],
        components: {
          securitySchemes: {
            apiKey: {
              type: 'apiKey',
              name: 'X-API-Key',
              in: 'header',
            },
          },
        },
      },
    });

    // Swagger UI
    fastify.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
      },
      staticCSP: true,
      transformStaticCSP: (header) => header,
    });
  }

  // ===========================================================================
  // MIDDLEWARE REGISTRATION
  // ===========================================================================

  private registerMiddleware(fastify: FastifyInstance): void {
    // Request logging
    fastify.addHook('onRequest', requestLogger);

    // Add request timestamp
    fastify.addHook('onRequest', async (request, reply) => {
      (request as any).startTime = Date.now();
    });

    // Add response time header
    fastify.addHook('onSend', async (request, reply) => {
      const startTime = (request as any).startTime;
      if (startTime) {
        const duration = Date.now() - startTime;
        reply.header('X-Response-Time', `${duration}ms`);
      }
    });
  }

  // ===========================================================================
  // ROUTE REGISTRATION
  // ===========================================================================

  private registerRoutes(fastify: FastifyInstance): void {
    const prefix = appConfig.api.prefix;

    // Root endpoint
    fastify.get('/', async (request, reply) => {
      return {
        name: 'Transcription Palantir API',
        version: '1.0.0',
        status: 'operational',
        timestamp: new Date().toISOString(),
        documentation: '/docs',
      };
    });

    // Health check routes
    fastify.register(healthRoutes, { prefix });

    // Job management routes
    fastify.register(jobRoutes, { prefix });

    // TODO: Add more route groups
    // - Queue monitoring routes
    // - Worker management routes
    // - Metrics routes
    // - WebSocket routes for real-time updates
  }

  // ===========================================================================
  // SERVER LIFECYCLE
  // ===========================================================================

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('API server is already running');
      return;
    }

    try {
      await this.app.listen({
        port: appConfig.port,
        host: '0.0.0.0',
      });

      this.isRunning = true;

      logger.info({
        port: appConfig.port,
        environment: appConfig.env,
        apiPrefix: appConfig.api.prefix,
      }, '🚀 API server started successfully');

      logger.info(`📚 API Documentation available at: http://localhost:${appConfig.port}/docs`);

    } catch (error) {
      logger.error({ error }, 'Failed to start API server');
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      await this.app.close();
      this.isRunning = false;
      logger.info('✅ API server stopped gracefully');
    } catch (error) {
      logger.error({ error }, 'Error stopping API server');
      throw error;
    }
  }

  // ===========================================================================
  // GETTERS
  // ===========================================================================

  get instance(): FastifyInstance {
    return this.app;
  }

  get running(): boolean {
    return this.isRunning;
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const apiServer = new ApiServer();

// =============================================================================
// STANDALONE EXECUTION
// =============================================================================

if (import.meta.main) {
  const server = new ApiServer();

  server.start().catch((error) => {
    logger.fatal({ error }, 'Failed to start API server');
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down API server...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down API server...');
    await server.stop();
    process.exit(0);
  });
}
