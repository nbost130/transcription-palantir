/**
 * 🔮 Transcription Palantir - API Integration Tests
 *
 * Tests the Fastify API server endpoints
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { apiServer } from '../../src/api/server.js';
import { transcriptionQueue } from '../../src/services/queue.js';

describe('API Integration Tests', () => {
  beforeAll(async () => {
    await transcriptionQueue.initialize();
    await apiServer.start();
  });

  afterAll(async () => {
    await apiServer.stop();
    await transcriptionQueue.close();
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

  test('POST /jobs should create a new job (with error for non-existent file)', async () => {
    const response = await fetch('http://localhost:3000/api/v1/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: '/nonexistent/test-file.mp3',
        priority: 3,
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
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
