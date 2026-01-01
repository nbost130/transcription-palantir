/**
 * 🔮 Transcription Palantir - Queue Integration Tests
 *
 * Tests the BullMQ queue system with Redis
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { transcriptionQueue } from '../../src/services/queue.js';
import { JobStatus, JobPriority } from '../../src/types/index.js';

describe('Queue Integration Tests', () => {
  beforeAll(async () => {
    await transcriptionQueue.initialize();
  });

  afterAll(async () => {
    await transcriptionQueue.close();
  });

  beforeEach(async () => {
    await transcriptionQueue.cleanQueue(0);
  });

  test('should connect to Redis', async () => {
    expect(transcriptionQueue.isReady).toBe(true);
  });

  test('should add a job to the queue', async () => {
    const jobData = {
      fileName: 'test-audio.mp3',
      filePath: '/tmp/test-audio.mp3',
      fileSize: 1024,
      mimeType: 'audio/mpeg',
      priority: JobPriority.HIGH,
    };

    const job = await transcriptionQueue.addJob(jobData);

    expect(job).toBeDefined();
    expect(job.id).toBeDefined();
    expect(job.data.fileName).toBe('test-audio.mp3');

    const retrievedJob = await transcriptionQueue.getJob(job.id!);
    expect(retrievedJob).toBeDefined();
    expect(retrievedJob?.id).toBe(job.id);
  });

  test('should retrieve queue statistics', async () => {
    // Add some jobs
    await transcriptionQueue.addJob({
      fileName: 'job1.mp3',
      filePath: '/tmp/job1.mp3',
      fileSize: 100,
      mimeType: 'audio/mpeg',
      priority: JobPriority.URGENT,
    });

    await transcriptionQueue.addJob({
      fileName: 'job2.mp3',
      filePath: '/tmp/job2.mp3',
      fileSize: 100,
      mimeType: 'audio/mpeg',
      priority: JobPriority.URGENT,
    });

    const stats = await transcriptionQueue.getQueueStats();

    expect(stats.total).toBeGreaterThanOrEqual(2);
  });

  test('should pause and resume queue', async () => {
    await transcriptionQueue.pauseQueue();
    // Verify paused state if possible, or just that it doesn't throw

    await transcriptionQueue.resumeQueue();
    // Verify resumed
  });

  test('should remove a job from queue', async () => {
    const job = await transcriptionQueue.addJob({
      fileName: 'to-remove.mp3',
      filePath: '/tmp/to-remove.mp3',
      fileSize: 100,
      mimeType: 'audio/mpeg',
      priority: JobPriority.NORMAL,
    });

    expect(job.id).toBeDefined();

    await transcriptionQueue.removeJob(job.id!);

    const retrievedJob = await transcriptionQueue.getJob(job.id!);
    expect(retrievedJob).toBeUndefined();
  });
});
