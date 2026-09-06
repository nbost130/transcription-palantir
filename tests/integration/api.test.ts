/**
 * 🔮 Transcription Palantir - API Integration Tests
 *
 * Tests the Fastify API server endpoints with mocked dependencies
 */

/**
 * 🔮 Transcription Palantir - API Integration Tests
 *
 * Tests the Fastify API server endpoints with mocked dependencies
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { apiServer } from '../../src/api/server.js';
import { appConfig } from '../../src/config/index.js';
import { fileWatcher } from '../../src/services/file-watcher.js';
import { transcriptionQueue } from '../../src/services/queue.js';

// Override watch directory for tests to avoid processing real files
const TEST_WATCH_DIR = join(tmpdir(), `palantir-test-watch-${Date.now()}`);
appConfig.processing.watchDirectory = TEST_WATCH_DIR;

const BASE_URL = `http://127.0.0.1:${appConfig.port}`;

describe('API Integration Tests', () => {
  beforeAll(async () => {
    // Ensure watch directory exists
    await mkdir(TEST_WATCH_DIR, { recursive: true });

    await transcriptionQueue.initialize();
    // Clean existing jobs (without obliterating connection)
    await transcriptionQueue.cleanQueue(0);

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

  test('POST /jobs then GET /jobs/:jobId returns the same job with its fields (not an empty object)', async () => {
    // Regression: the getJob response schema declared `data: { type: 'object' }`
    // with no properties, and fast-json-stringify serialised every job as `{}`.
    const audio = join(TEST_WATCH_DIR, `lookup-${Date.now()}.wav`);
    await writeFile(audio, Buffer.alloc(2048, 1));

    const created = await fetch(`${BASE_URL}/api/v1/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: audio, priority: 4 }),
    });
    const createdBody = await created.json();
    expect(created.status).toBe(201);
    const jobId: string = createdBody.data.jobId;
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);

    const fetched = await fetch(`${BASE_URL}/api/v1/jobs/${jobId}`);
    const body = await fetched.json();
    expect(fetched.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.jobId).toBe(jobId);
    expect(body.data.status).toBeDefined();
    expect(body.data.data.fileName).toBe(basename(audio));
    expect(Object.keys(body.data).length).toBeGreaterThan(5);

    const missing = await fetch(`${BASE_URL}/api/v1/jobs/does-not-exist-${Date.now()}`);
    expect(missing.status).toBe(404);
    expect((await missing.json()).success).toBe(false);

    await fetch(`${BASE_URL}/api/v1/jobs/${jobId}`, { method: 'DELETE' });
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

  test.skip('POST /system/reconcile should trigger reconciliation', async () => {
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
