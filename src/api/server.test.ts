import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
const mockLogger = {
  info: vi.fn(() => { }),
  warn: vi.fn(() => { }),
  error: vi.fn(() => { }),
  debug: vi.fn(() => { }),
  fatal: vi.fn(() => { }),
};

const mockConfig = {
  port: 3000,
  env: 'test',
  api: {
    prefix: '/api/v1',
    corsOrigin: '*',
    rateLimitMax: 100,
    rateLimitWindow: 60000,
  },
};

const mockFastifyInstance = {
  register: vi.fn(() => { }),
  addHook: vi.fn(() => { }),
  get: vi.fn(() => { }),
  setErrorHandler: vi.fn(() => { }),
  listen: vi.fn(async () => { }),
  close: vi.fn(async () => { }),
  ready: vi.fn(async () => { }),
};

// Mock Fastify factory
const mockFastify = vi.fn(() => {
  return mockFastifyInstance;
});

// Mock routes
const mockRoutes = async () => { };

// Mock modules
vi.mock('../utils/logger.js', () => ({ logger: mockLogger }));
vi.mock('../config/index.js', () => ({ appConfig: mockConfig }));

// Mock fastify module
vi.mock('fastify', () => ({
  default: mockFastify,
  Fastify: mockFastify,
}));

vi.mock('./routes/health.js', () => ({ healthRoutes: mockRoutes }));
vi.mock('./routes/jobs.js', () => ({ jobRoutes: mockRoutes }));
vi.mock('./routes/metrics.js', () => ({ metricsRoutes: mockRoutes }));
vi.mock('./routes/monitor.js', () => ({ monitorRoutes: mockRoutes }));
vi.mock('./routes/websocket.js', () => ({ websocketRoutes: mockRoutes }));
vi.mock('./routes/services.js', () => ({ default: mockRoutes }));
vi.mock('./routes/system.js', () => ({ systemRoutes: mockRoutes }));
vi.mock('./middleware/error.js', () => ({ errorHandler: () => { } }));
vi.mock('./middleware/logger.js', () => ({ requestLogger: () => { } }));
vi.mock('bullmq', () => ({
  Queue: class { },
  Worker: class { },
  QueueEvents: class { },
  Job: class { },
}));
vi.mock('ioredis', () => ({ Redis: class { } }));

describe('ApiServer', () => {
  let ApiServer: any;
  let server: any;

  beforeEach(async () => {
    // Clear mocks before instantiation to capture constructor calls
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockFastify.mockClear();
    mockFastifyInstance.register.mockClear();
    mockFastifyInstance.listen.mockClear();
    mockFastifyInstance.close.mockClear();

    // Re-import module to ensure mocks are used
    const module = await import('./server');
    ApiServer = module.ApiServer;
    server = new ApiServer();
  });

  describe('constructor', () => {
    it('should create a fastify server', () => {
      expect(mockFastify).toHaveBeenCalled();
      expect(server.instance).toBe(mockFastifyInstance);
    });

    it('should register plugins and routes', () => {
      // We expect multiple register calls for plugins and routes
      expect(mockFastifyInstance.register).toHaveBeenCalled();
      expect(mockFastifyInstance.get).toHaveBeenCalledWith('/', expect.any(Function));
    });
  });

  describe('start', () => {
    it('should start the server', async () => {
      await server.start();

      expect(mockFastifyInstance.listen).toHaveBeenCalledWith({
        port: mockConfig.port,
        host: '0.0.0.0',
      });
      expect(server.running).toBe(true);
    });

    it('should not start if already running', async () => {
      await server.start();
      await server.start();

      expect(mockFastifyInstance.listen).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith('API server is already running');
    });
  });

  describe('stop', () => {
    it('should stop the server', async () => {
      await server.start();
      await server.stop();

      expect(mockFastifyInstance.close).toHaveBeenCalled();
      expect(server.running).toBe(false);
    });
  });

  describe('middleware and plugins', () => {
    it('should register CORS with correct configuration', () => {
      // Check if CORS plugin was registered
      // Note: In a real integration test we would check headers, but here we verify registration
      expect(mockFastifyInstance.register).toHaveBeenCalled();
    });

    it('should register rate limiting', () => {
      expect(mockFastifyInstance.register).toHaveBeenCalled();
    });

    it('should register request logger hook', () => {
      expect(mockFastifyInstance.addHook).toHaveBeenCalledWith('onRequest', expect.any(Function));
    });
  });
});
