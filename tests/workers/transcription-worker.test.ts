import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TranscriptionWorker } from '../../src/workers/transcription-worker';
import { appConfig } from '../../src/config/index';
import { logger } from '../../src/utils/logger';
import { Worker } from 'bullmq';

// Mock dependencies
vi.mock('bullmq', () => ({
  Worker: vi.fn(),
  Job: vi.fn(),
}));
vi.mock('ioredis', () => {
  return {
    default: vi.fn(function () {
      return {
        on: vi.fn(),
      };
    }),
  };
});
vi.mock('../../src/services/whisper.js', () => ({
  whisperService: {
    transcribeAudio: vi.fn(),
  },
}));
vi.mock('../../src/config/index.js', () => ({
  appConfig: {
    processing: {
      maxWorkers: 2,
      lockDuration: 60000,
      stalledInterval: 30000,
      outputDirectory: '/tmp/out',
      completedDirectory: '/tmp/done',
      failedDirectory: '/tmp/fail',
      watchDirectory: '/tmp/in',
    },
    whisper: {
      model: 'tiny',
      binaryPath: '/usr/bin/whisper',
      pythonPath: '/usr/bin/python3',
      computeType: 'float16',
      language: 'auto',
      task: 'transcribe',
      usePython: true,
    },
    redis: {
      host: 'localhost',
      port: 6379,
    },
  },
  getRedisUrl: vi.fn().mockReturnValue('redis://localhost:6379'),
  getWhisperCommand: vi.fn().mockReturnValue(['whisper']),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('TranscriptionWorker', () => {
  let worker: TranscriptionWorker;
  let mockBullWorker: any;

  beforeEach(() => {
    vi.resetAllMocks();

    // Mock BullMQ Worker constructor
    mockBullWorker = {
      on: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    };
    (Worker as any).mockImplementation(() => mockBullWorker);

    worker = new TranscriptionWorker();
  });

  afterEach(async () => {
    await worker.stop();
  });

  it('should initialize Worker with correct stalled job configuration', async () => {
    await worker.start();

    expect(Worker).toHaveBeenCalledWith(
      'transcription',
      expect.any(Function),
      expect.objectContaining({
        lockDuration: 60000,
        stalledInterval: 30000,
        concurrency: 2,
      })
    );
  });

  it('should log [SELF-HEAL] warning when job stalls', async () => {
    await worker.start();

    // Find the 'stalled' event handler
    const stalledHandler = mockBullWorker.on.mock.calls.find(
      (call: any[]) => call[0] === 'stalled'
    )?.[1];
    expect(stalledHandler).toBeDefined();

    // Trigger the handler
    stalledHandler('job-123');

    expect(logger.warn).toHaveBeenCalledWith(
      { jobId: 'job-123' },
      expect.stringContaining('[SELF-HEAL]')
    );
  });
});
