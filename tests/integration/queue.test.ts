/**
 * 🔮 Transcription Palantir - Queue Integration Tests
 *
 * Tests the BullMQ queue system with Redis
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { transcriptionQueue } from '../../src/services/queue.js';
import { JobStatus, JobPriority } from '../../src/types/index.js';

describe('Queue Integration Tests', () => {
  beforeAll(async () => {
    // Initialize queue
    await transcriptionQueue.initialize();
  });

  afterAll(async () => {
    // Cleanup
    await transcriptionQueue.cleanQueue(0);
    await transcriptionQueue.close();
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
      status: JobStatus.PENDING,
      priority: JobPriority.NORMAL,
      progress: 0,
      createdAt: new Date(),
      attempts: 0,
      maxAttempts: 3,
      metadata: {
        originalPath: '/tmp/test-audio.mp3',
        audioFormat: 'mp3',
        whisperModel: 'small',
      },
    };

    const job = await transcriptionQueue.addJob(jobData);

    expect(job).toBeDefined();
    expect(job.id).toBeDefined();
    expect(job.data.fileName).toBe('test-audio.mp3');
  });

  test('should retrieve queue statistics', async () => {
    const stats = await transcriptionQueue.getQueueStats();

    expect(stats).toHaveProperty('waiting');
    expect(stats).toHaveProperty('active');
    expect(stats).toHaveProperty('completed');
    expect(stats).toHaveProperty('failed');
    expect(stats).toHaveProperty('total');
    expect(typeof stats.total).toBe('number');
  });

  test('should add jobs with different priorities', async () => {
    const jobs = await Promise.all([
      transcriptionQueue.addJob({
        fileName: 'urgent.mp3',
        filePath: '/tmp/urgent.mp3',
        fileSize: 512,
        mimeType: 'audio/mpeg',
        status: JobStatus.PENDING,
        priority: JobPriority.URGENT,
        progress: 0,
        createdAt: new Date(),
        attempts: 0,
        maxAttempts: 3,
        metadata: {
          originalPath: '/tmp/urgent.mp3',
          audioFormat: 'mp3',
          whisperModel: 'small',
        },
      }),
      transcriptionQueue.addJob({
        fileName: 'low.mp3',
        filePath: '/tmp/low.mp3',
        fileSize: 2048,
        mimeType: 'audio/mpeg',
        status: JobStatus.PENDING,
        priority: JobPriority.LOW,
        progress: 0,
        createdAt: new Date(),
        attempts: 0,
        maxAttempts: 3,
        metadata: {
          originalPath: '/tmp/low.mp3',
          audioFormat: 'mp3',
          whisperModel: 'small',
        },
      }),
    ]);

    expect(jobs).toHaveLength(2);
    expect(jobs[0].data.fileName).toBe('urgent.mp3');
    expect(jobs[1].data.fileName).toBe('low.mp3');
  });

  test('should pause and resume queue', async () => {
    await transcriptionQueue.pauseQueue();
    // Queue should be paused
    await transcriptionQueue.resumeQueue();
    // Queue should be active again
  });

  test('should remove a job from queue', async () => {
    const job = await transcriptionQueue.addJob({
      fileName: 'to-delete.mp3',
      filePath: '/tmp/to-delete.mp3',
      fileSize: 256,
      mimeType: 'audio/mpeg',
      status: JobStatus.PENDING,
      priority: JobPriority.NORMAL,
      progress: 0,
      createdAt: new Date(),
      attempts: 0,
      maxAttempts: 3,
      metadata: {
        originalPath: '/tmp/to-delete.mp3',
        audioFormat: 'mp3',
        whisperModel: 'small',
      },
    });

    await transcriptionQueue.removeJob(job.id!);
    const retrieved = await transcriptionQueue.getJob(job.id!);
    expect(retrieved).toBeUndefined();
  });
});
