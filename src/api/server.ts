/**
 * 🔮 Transcription Palantir - API Server
 *
 * Fastify-based REST API server with monitoring and metrics endpoints
 */

import Fastify, { FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyWebsocket from '@fastify/websocket';

import { appConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';

import { metricsRoutes } from './routes/metrics.js';
import { monitorRoutes } from './routes/monitor.js';
import { websocketRoutes } from './routes/websocket.js';

// =============================================================================
// API SERVER CLASS
// =============================================================================

export class ApiServer {
  private app: FastifyInstance;
  private isRunning = false;

  constructor() {
    this.app = Fastify({
      logger: logger as any,
      requestIdHeader: 'x-request-id',
      requestIdLogLabel: 'requestId',
      disableRequestLogging: false,
      trustProxy: true,
    });
  }

  // ===========================================================================
  // LIFECYCLE METHODS
  // ===========================================================================

  async initialize(): Promise<void> {
    logger.info('Initializing API server...');

    // Register plugins
    await this.registerPlugins();

    // Register routes
    await this.registerRoutes();

    logger.info('API server initialized');
  }

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
        host: '0.0.0.0',
        environment: appConfig.env,
      }, 'API server started');

    } catch (error) {
      logger.error({ error }, 'Failed to start API server');
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping API server...');

    try {
      await this.app.close();
      this.isRunning = false;
      logger.info('API server stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping API server');
      throw error;
    }
  }

  // ===========================================================================
  // PLUGIN REGISTRATION
  // ===========================================================================

  private async registerPlugins(): Promise<void> {
    // Security headers
    await this.app.register(fastifyHelmet, {
      contentSecurityPolicy: false, // Disable for Swagger UI
    });

    // CORS
    await this.app.register(fastifyCors, {
      origin: appConfig.env === 'development' ? '*' : appConfig.api.corsOrigin,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    });

    // Rate limiting
    await this.app.register(fastifyRateLimit, {
      max: 100,
      timeWindow: '1 minute',
      ban: 3, // Ban after 3 violations
      cache: 10000,
    });

    // WebSocket support
    await this.app.register(fastifyWebsocket);

    // Swagger documentation
    await this.app.register(fastifySwagger, {
      swagger: {
        info: {
          title: 'Transcription Palantir API',
          description: 'Modern transcription system with monitoring and metrics',
          version: '1.0.0',
        },
        schemes: ['http', 'https'],
        consumes: ['application/json'],
        produces: ['application/json'],
        tags: [
          { name: 'metrics', description: 'Prometheus metrics endpoints' },
          { name: 'monitoring', description: 'Queue and worker monitoring' },
          { name: 'websocket', description: 'Real-time updates via WebSocket' },
        ],
      },
    });

    await this.app.register(fastifySwaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
      },
      staticCSP: true,
    });

    logger.info('API plugins registered');
  }

  // ===========================================================================
  // ROUTE REGISTRATION
  // ===========================================================================

  private async registerRoutes(): Promise<void> {
    const prefix = '/api/v1';

    // Health check
    this.app.get('/health', async () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    }));

    // API routes
    await this.app.register(metricsRoutes, { prefix });
    await this.app.register(monitorRoutes, { prefix });
    await this.app.register(websocketRoutes, { prefix });

    // Root redirect
    this.app.get('/', async (request, reply) => {
      return reply.redirect('/docs');
    });

    logger.info('API routes registered');
  }

  // ===========================================================================
  // ACCESSORS
  // ===========================================================================

  getApp(): FastifyInstance {
    return this.app;
  }

  getIsRunning(): boolean {
    return this.isRunning;
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const apiServer = new ApiServer();
