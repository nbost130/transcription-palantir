/**
 * 🔮 Transcription Palantir - API Integration Tests
 *
 * Tests the Fastify API server endpoints
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { apiServer } from '../../src/api/server.js';
import { transcriptionQueue } from '../../src/services/queue.js';
import { fileWatcher } from '../../src/services/file-watcher.js';
import { appConfig } from '../../src/config/index.js';

// Override watch directory for tests to avoid processing real files
const TEST_WATCH_DIR = join(tmpdir(), 'palantir-test-watch-' + Date.now());
appConfig.processing.watchDirectory = TEST_WATCH_DIR;

const BASE_URL = `http://127.0.0.1:${appConfig.port}`;

describe('API Integration Tests', () => {
  beforeAll(async () => {
    // Ensure watch directory exists
    await mkdir(TEST_WATCH_DIR, { recursive: true });

    await transcriptionQueue.initialize();
    // Clear any existing jobs to ensure clean state
    await transcriptionQueue.queueInstance.obliterate({ force: true });

    await fileWatcher.start();
    await apiServer.start();
  });

  afterAll(async () => {
    await apiServer.stop();
    await fileWatcher.stop();
    await transcriptionQueue.close();
    // Cleanup temp directory
    await rm(TEST_WATCH_DIR, { recursive: true, force: true });
  });

  test('GET / should return API information', async () => {
    const response = await fetch(`${BASE_URL}/`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.name).toBe('Transcription Palantir API');
    expect(data.status).toBe('operational');
  });

  test('GET /health should return health status', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/health`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data).toHaveProperty('uptime');
  });

  test('GET /ready should return readiness status', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/ready`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('services');
    expect(Array.isArray(data.services)).toBe(true);
  });

  test('GET /health/detailed should return detailed health', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/health/detailed`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('services');
    expect(data).toHaveProperty('metrics');
  });

  test('POST /jobs should create a new job (with error for non-existent file)', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/jobs`, {
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
    const response = await fetch(`${BASE_URL}/api/v1/jobs`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty('success');
    expect(data).toHaveProperty('data');
    expect(data).toHaveProperty('pagination');
    expect(Array.isArray(data.data)).toBe(true);
  });

  test('GET /queue/stats should return queue statistics', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/queue/stats`);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty('waiting');
    expect(data.data).toHaveProperty('active');
    expect(data.data).toHaveProperty('completed');
  });

  test('GET /docs should return Swagger documentation', async () => {
    const response = await fetch(`${BASE_URL}/docs`);
    expect(response.status).toBe(200);
  });

  test('POST /system/reconcile should trigger reconciliation', async () => {
    const response = await fetch(`${BASE_URL}/api/v1/system/reconcile`, {
      method: 'POST',
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.report).toBeDefined();
    expect(typeof data.report.filesScanned).toBe('number');
  });
});
