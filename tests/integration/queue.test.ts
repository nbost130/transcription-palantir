/**
 * 🔮 Transcription Palantir - Queue Integration Tests
 *
 * Tests the BullMQ queue system with Redis mocks
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mockQueueInstance } from '../mocks';

// Mock dependencies
const mockLogger = {
  info: mock(() => { }),
  warn: mock(() => { }),
  error: mock(() => { }),
  debug: mock(() => { }),
  fatal: mock(() => { }),
};



// Mocks for bullmq and ioredis are handled in tests/setup.ts

// Mock BullMQ




// Register mocks
mock.module('../../src/utils/logger.js', () => ({
  logger: mockLogger,
  queueLogger: mockLogger,
  logQueueEvent: mock(() => { }),
}));
// Set environment variables for testing
process.env.NODE_ENV = 'test';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.WATCH_DIRECTORY = '/tmp/watch';
process.env.OUTPUT_DIRECTORY = '/tmp/output';
process.env.COMPLETED_DIRECTORY = '/tmp/completed';
process.env.FAILED_DIRECTORY = '/tmp/failed';


describe('Queue Integration Tests', () => {
  let transcriptionQueue: any;

  beforeEach(async () => {
    // Import module dynamically to ensure mocks are applied
    const module = await import('../../src/services/queue');
    transcriptionQueue = module.transcriptionQueue;

    // Reset mocks
    mockQueueInstance.add.mockClear();
    mockQueueInstance.pause.mockClear();
    mockQueueInstance.resume.mockClear();
    mockQueueInstance.getJob.mockClear();
    mockQueueInstance.getJobCounts.mockClear();
    mockQueueInstance.getWaiting.mockClear();

    // Initialize
    await transcriptionQueue.initialize();
  });

  afterEach(async () => {
    await transcriptionQueue.close();
  });

  test('should connect to Redis (mocked)', async () => {
    expect(transcriptionQueue.isReady).toBe(true);
  });

  test('should add a job to the queue', async () => {
    const jobData = {
      fileName: 'test-audio.mp3',
      filePath: '/tmp/test-audio.mp3',
      fileSize: 1024,
      mimeType: 'audio/mpeg',
      priority: 1,
    };

    const job = await transcriptionQueue.addJob(jobData);

    expect(job).toBeDefined();
    expect(job.id).toBe('job-123');
    expect(job.data.fileName).toBe('test-audio.mp3');
    expect(mockQueueInstance.add).toHaveBeenCalled();
  });

  test('should retrieve queue statistics', async () => {
    mockQueueInstance.getWaiting.mockResolvedValue(new Array(5));
    mockQueueInstance.getActive.mockResolvedValue(new Array(2));
    mockQueueInstance.getCompleted.mockResolvedValue(new Array(10));
    mockQueueInstance.getFailed.mockResolvedValue(new Array(1));

    const stats = await transcriptionQueue.getQueueStats();

    expect(stats).toHaveProperty('waiting', 5);
    expect(stats).toHaveProperty('active', 2);
    expect(stats).toHaveProperty('completed', 10);
    expect(stats).toHaveProperty('failed', 1);

    expect(mockQueueInstance.getWaiting).toHaveBeenCalled();
  });

  test('should pause and resume queue', async () => {
    await transcriptionQueue.pauseQueue();
    expect(mockQueueInstance.pause).toHaveBeenCalled();

    await transcriptionQueue.resumeQueue();
    expect(mockQueueInstance.resume).toHaveBeenCalled();
  });

  test('should remove a job from queue', async () => {
    // We mock getJob to return a job with a remove method
    const mockJob = { remove: mock(async () => { }) };
    mockQueueInstance.getJob.mockResolvedValue(mockJob);

    const job = await transcriptionQueue.getJob('job-123');
    expect(job).toBeDefined();

    await transcriptionQueue.removeJob('job-123');
    expect(mockJob.remove).toHaveBeenCalled();
  });
});
