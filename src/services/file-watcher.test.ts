import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
const mockLogger = {
  info: vi.fn(() => {}),
  warn: vi.fn(() => {}),
  error: vi.fn(() => {}),
  debug: vi.fn(() => {}),
  fatal: vi.fn(() => {}),
};

const mockConfig = {
  processing: {
    watchDirectory: '/test/watch',
    supportedFormats: ['mp3', 'wav'],
    minFileSize: 0.1,
    maxFileSize: 100,
    maxAttempts: 3,
  },
  whisper: {
    model: 'base',
    language: 'en',
  },
  redis: {
    host: 'localhost',
    port: 6379,
    connectTimeout: 10000,
  },
  env: 'test',
};

// Mock BullMQ
const mockQueueInstance = {
  add: vi.fn(async () => ({ id: 'job-123', data: {} })),
  on: vi.fn(() => {}),
  close: vi.fn(async () => {}),
  getJob: vi.fn(async () => null),
  getJobCounts: vi.fn(async () => ({ waiting: 0, active: 0, completed: 0, failed: 0 })),
  pause: vi.fn(async () => {}),
  resume: vi.fn(async () => {}),
  clean: vi.fn(async () => []),
  waitUntilReady: vi.fn(async () => {}),
};

const _mockWorkerInstance = {
  on: vi.fn(() => {}),
  close: vi.fn(async () => {}),
};

const _mockQueueEventsInstance = {
  on: vi.fn(() => {}),
  close: vi.fn(async () => {}),
  waitUntilReady: vi.fn(async () => {}),
};

vi.mock('../utils/logger.js', () => ({
  logger: mockLogger,
  queueLogger: mockLogger,
  apiLogger: mockLogger,
  workerLogger: mockLogger,
  fileWatcherLogger: mockLogger,
  transcriptionLogger: mockLogger,
  logQueueEvent: vi.fn(() => {}),
  logFileWatcherEvent: vi.fn(() => {}),
  logError: vi.fn((...args) => console.error('MOCK ERROR:', ...args)),
}));

vi.mock('../config/index.js', () => ({
  appConfig: mockConfig,
  getRedisUrl: () => 'redis://localhost:6379',
}));

const mockFileTracker = {
  connect: vi.fn(async () => {}),
  isProcessed: vi.fn(async () => false),
  markProcessed: vi.fn(async () => {}),
};

const mockChokidarWatcher = {
  on: vi.fn(function (this: any) {
    return this;
  }),
  close: vi.fn(async () => {}),
};

const mockChokidar = {
  watch: vi.fn(() => mockChokidarWatcher),
};

// Mock fs/promises
const mockFs = {
  stat: vi.fn(async () => ({
    isFile: () => true,
    isDirectory: () => true,
    size: 1024 * 1024 * 5, // 5MB
    birthtime: new Date(),
    mtime: new Date(),
  })),
  access: vi.fn(async () => {}),
  readdir: vi.fn(async () => []),
  rename: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
  readFile: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
};

vi.mock('./file-tracker.js', () => ({ fileTracker: mockFileTracker }));
vi.mock('chokidar', () => ({ default: mockChokidar }));
vi.mock('fs/promises', () => ({
  ...mockFs,
  default: mockFs,
}));
vi.mock('node:fs/promises', () => ({
  stat: mockFs.stat,
  access: mockFs.access,
  readdir: mockFs.readdir,
  rename: mockFs.rename,
  writeFile: mockFs.writeFile,
  readFile: mockFs.readFile,
  mkdir: mockFs.mkdir,
  default: mockFs,
}));

describe('FileWatcherService', () => {
  let FileWatcherService: any;
  let service: any;

  beforeEach(async () => {
    const module = await import('./file-watcher');
    FileWatcherService = module.FileWatcherService;
    service = new FileWatcherService();

    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.debug.mockClear();
    mockLogger.fatal.mockClear();
    mockQueueInstance.add.mockClear();
    mockFileTracker.connect.mockClear();
    mockFileTracker.isProcessed.mockClear();
    mockFileTracker.markProcessed.mockClear();
    mockChokidar.watch.mockClear();
    mockChokidarWatcher.on.mockClear();
    mockChokidarWatcher.close.mockClear();
    mockFs.stat.mockClear();
    mockFs.access.mockClear();
    mockFs.readdir.mockClear();
  });

  describe('start', () => {
    it('should start the watcher successfully', async () => {
      await service.start();

      expect(mockFileTracker.connect).toHaveBeenCalled();
      expect(mockFs.access).toHaveBeenCalledWith(mockConfig.processing.watchDirectory, expect.anything());
      expect(mockChokidar.watch).toHaveBeenCalledWith(mockConfig.processing.watchDirectory, expect.anything());
      expect(service.running).toBe(true);
    });

    it('should not start if already running', async () => {
      // First start
      await service.start();
      expect(mockChokidar.watch).toHaveBeenCalledTimes(1);

      // Second start
      await service.start();
      expect(mockChokidar.watch).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledWith('File watcher is already running');
    });
  });

  describe('handleFileAdded', () => {
    it('should process a valid new file', async () => {
      const filePath = '/test/watch/audio.mp3';

      // Spy on transcriptionQueue.addJob
      const queueModule = await import('./queue');
      const addJobSpy = vi.spyOn(queueModule.transcriptionQueue, 'addJob');
      addJobSpy.mockResolvedValue({ id: 'job-123' } as any);

      // Access private method for testing
      await (service as any).handleFileAdded(filePath);

      expect(mockFileTracker.isProcessed).toHaveBeenCalledWith(filePath);

      expect(addJobSpy).toHaveBeenCalled();

      expect(mockFileTracker.markProcessed).toHaveBeenCalledWith(filePath, expect.any(String));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.objectContaining({ filePath }), 'New file detected');

      addJobSpy.mockRestore();
    });

    it('should skip if file is already processed', async () => {
      const filePath = '/test/watch/processed.mp3';
      mockFileTracker.isProcessed.mockResolvedValueOnce(true);

      // Spy on transcriptionQueue.addJob
      const queueModule = await import('./queue');
      const addJobSpy = vi.spyOn(queueModule.transcriptionQueue, 'addJob');

      await (service as any).handleFileAdded(filePath);

      expect(addJobSpy).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ filePath }),
        expect.stringContaining('already processed')
      );

      addJobSpy.mockRestore();
    });

    it('should skip if file validation fails (unsupported format)', async () => {
      const filePath = '/test/watch/image.png';

      // Spy on transcriptionQueue.addJob
      const queueModule = await import('./queue');
      const addJobSpy = vi.spyOn(queueModule.transcriptionQueue, 'addJob');

      await (service as any).handleFileAdded(filePath);

      expect(addJobSpy).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ filePath }),
        expect.stringContaining('File validation failed')
      );

      addJobSpy.mockRestore();
    });
  });

  describe('validateFile', () => {
    it('should validate a correct file', async () => {
      const filePath = '/test/watch/test.mp3';
      const result = await (service as any).validateFile(filePath);

      expect(result.valid).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata.extension).toBe('mp3');
    });

    it('should reject unsupported format', async () => {
      const filePath = '/test/watch/test.txt';
      const result = await (service as any).validateFile(filePath);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Unsupported format');
    });

    it('should reject file too small', async () => {
      const filePath = '/test/watch/small.mp3';
      mockFs.stat.mockResolvedValueOnce({
        isFile: () => true,
        size: 100, // Very small
      } as any);

      const result = await (service as any).validateFile(filePath);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('File too small');
    });
  });

  describe('stop', () => {
    it('should stop the watcher', async () => {
      await service.start();
      await service.stop();

      expect(mockChokidarWatcher.close).toHaveBeenCalled();
      expect(service.running).toBe(false);
    });
  });
});
