/**
 * 🔮 Transcription Palantir - API Integration Tests
 *
 * Tests the Fastify API server endpoints with mocked dependencies
 */

import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test';
import { mockQueueInstance } from '../mocks';

// Mock dependencies
const mockLogger = {
  info: mock(() => { }),
  warn: mock(() => { }),
  error: mock((...args) => console.error('API MOCK ERROR:', ...args)),
  debug: mock(() => { }),
  fatal: mock(() => { }),
};



// Mocks for bullmq and ioredis are handled in tests/setup.ts

// Mock FileWatcher
const mockFileWatcher = {
  running: true,
  processedCount: 0,
  start: mock(() => Promise.resolve()),
  stop: mock(() => Promise.resolve()),
};





// Register mocks
mock.module('../../src/utils/logger.js', () => ({
  logger: mockLogger,
  apiLogger: mockLogger,
  queueLogger: mockLogger,
  logQueueEvent: mock(() => { }),
  logApiRequest: mock(() => { }),
}));
// Set environment variables for testing
process.env.NODE_ENV = 'test';
process.env.PORT = '3000';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.WATCH_DIRECTORY = '/tmp/watch';
process.env.OUTPUT_DIRECTORY = '/tmp/output';
process.env.API_PREFIX = '/api/v1';
mock.module('../../src/services/file-watcher.js', () => ({
  fileWatcher: mockFileWatcher,
}));


describe('API Integration Tests', () => {
  let apiServer: any;
  let transcriptionQueue: any;

  beforeAll(async () => {
    // Create dummy file for testing
    await Bun.write('/tmp/test.mp3', 'dummy content');
    // Create watch directory
    const fs = await import('node:fs/promises');
    await fs.mkdir('/tmp/watch', { recursive: true });

    // Import modules dynamically
    const queueModule = await import('../../src/services/queue');
    const serverModule = await import('../../src/api/server');

    transcriptionQueue = queueModule.transcriptionQueue;
    apiServer = serverModule.apiServer;

    await transcriptionQueue.initialize();
    await apiServer.start();
  });

  afterAll(async () => {
    if (apiServer) await apiServer.stop();
    if (transcriptionQueue) await transcriptionQueue.close();

    // Cleanup dummy file
    try {
      const fs = await import('node:fs/promises');
      await fs.unlink('/tmp/test.mp3');
    } catch (e) {
      // Ignore
    }
  });

  test('GET / should return API information', async () => {
    const response = await fetch('http://localhost:3000/');
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.name).toBe('Transcription Palantir API');
    expect(data.status).toBe('operational');
  });

  test('GET /health should return health status', async () => {
    const response = await fetch('http://localhost:3000/api/v1/health');
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data).toHaveProperty('uptime');
  });

  test('GET /ready should return readiness status', async () => {
    const response = await fetch('http://localhost:3000/api/v1/ready');
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('services');
    expect(Array.isArray(data.services)).toBe(true);
  });

  test('GET /health/detailed should return detailed health', async () => {
    const response = await fetch('http://localhost:3000/api/v1/health/detailed');
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('services');
    expect(data).toHaveProperty('metrics');
  });

  test('POST /jobs should create a new job', async () => {
    const response = await fetch('http://localhost:3000/api/v1/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: '/tmp/test.mp3',
        priority: 3,
      }),
    });

    expect(response.status).toBe(201);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.jobId).toBe('job-123');
  });

  test('GET /jobs should return list of jobs', async () => {
    const response = await fetch('http://localhost:3000/api/v1/jobs');
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('success');
    expect(data).toHaveProperty('data');
    expect(data).toHaveProperty('pagination');
    expect(Array.isArray(data.data)).toBe(true);
  });

  test('GET /queue/stats should return queue statistics', async () => {
    const response = await fetch('http://localhost:3000/api/v1/queue/stats');
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty('waiting');
    expect(data.data).toHaveProperty('active');
    expect(data.data).toHaveProperty('completed');
  });

  test('GET /docs should return Swagger documentation', async () => {
    const response = await fetch('http://localhost:3000/docs');
    expect(response.status).toBe(200);
  });
});
