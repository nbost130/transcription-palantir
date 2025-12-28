import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test';
import { mockQueueInstance } from '../mocks';
import { join } from 'path';

// Mock dependencies
const mockLogger = {
    info: mock((...args) => console.log('INFO:', ...args)),
    warn: mock((...args) => console.log('WARN:', ...args)),
    error: mock((...args) => console.log('ERROR:', ...args)),
    debug: mock((...args) => console.log('DEBUG:', ...args)),
    fatal: mock((...args) => console.log('FATAL:', ...args)),
};



// Mock BullMQ


const mockWorkerInstance = {
    on: mock(() => { }),
    close: mock(async () => { }),
};

const mockQueueEventsInstance = {
    on: mock(() => { }),
    close: mock(async () => { }),
    waitUntilReady: mock(async () => { }),
};



// Mock Redis


// Mock Chokidar
const mockChokidarWatcher = {
    on: mock(function (this: any) { return this; }),
    close: mock(async () => { }),
};

const mockChokidar = {
    watch: mock(() => mockChokidarWatcher),
};

// Mock FS
const mockFs = {
    mkdir: mock(async () => { }),
    access: mock(async () => { }),
    stat: mock(async (path: string) => {
        const isDir = path === '/test/watch' || path === '/test/output' || path === '/test/completed' || path === '/test/failed';
        return {
            isFile: () => !isDir,
            isDirectory: () => isDir,
            size: 1024,
            birthtime: new Date(),
            mtime: new Date(),
        };
    }),
    readdir: mock(async () => []),
    rename: mock(async () => { }),
    writeFile: mock(async () => { }),
    readFile: mock(async () => 'mock content'),
};

// Mock Whisper Services
const mockWhisperService = {
    validateBinary: mock(async () => true),
};

const mockFasterWhisperService = {
    transcribe: mock(async () => ({ text: 'Transcribed text' })),
};

const mockFileTracker = {
    connect: mock(async () => { }),
    isProcessed: mock(async () => false),
    markProcessed: mock(async () => { }),
    unmarkProcessed: mock(async () => { }),
};

// Register mocks
mock.module('../../src/utils/logger.js', () => ({
    logger: mockLogger,
    apiLogger: mockLogger,
    workerLogger: mockLogger,
    queueLogger: mockLogger,
    fileWatcherLogger: mockLogger,
    transcriptionLogger: mockLogger,
    logQueueEvent: mock(() => { }),
    logJobStart: mock(() => { }),
    logJobComplete: mock(() => { }),
    logJobError: mock(() => { }),
    logApiRequest: mock(() => { }),
    logWorkerStart: mock(() => { }),
    logWorkerStop: mock(() => { }),
    logFileWatcherEvent: mock(() => { }),
    logError: mock(() => { }),
    logFatalError: mock(() => { }),
    createTimer: mock(() => ({ end: mock(() => 100) })),
}));

// Set environment variables for testing
process.env.NODE_ENV = 'test';
process.env.REDIS_HOST = 'localhost';
process.env.REDIS_PORT = '6379';
process.env.WATCH_DIRECTORY = '/test/watch';
process.env.OUTPUT_DIRECTORY = '/test/output';
process.env.COMPLETED_DIRECTORY = '/test/completed';
process.env.FAILED_DIRECTORY = '/test/failed';
process.env.SUPPORTED_FORMATS = 'wav';
process.env.MIN_FILE_SIZE = '0';
process.env.MAX_FILE_SIZE = '100';
process.env.MAX_JOB_ATTEMPTS = '3';
process.env.WHISPER_MODEL = 'base';
process.env.WHISPER_LANGUAGE = 'en';

mock.module('chokidar', () => ({ default: mockChokidar }));
mock.module('fs/promises', () => ({ ...mockFs, default: mockFs }));
mock.module('node:fs/promises', () => ({ ...mockFs, default: mockFs }));
mock.module('../../src/services/whisper.js', () => ({ whisperService: mockWhisperService }));
mock.module('../../src/services/faster-whisper.js', () => ({ fasterWhisperService: mockFasterWhisperService }));
mock.module('../../src/services/file-tracker.js', () => ({ fileTracker: mockFileTracker }));
mock.module('child_process', () => ({ spawn: mock(() => ({})) }));

describe('Transcription Flow Integration', () => {
    let FileWatcherService: any;
    let TranscriptionWorker: any;
    let transcriptionQueue: any;
    let fileWatcher: any;
    let worker: any;

    beforeEach(async () => {
        // Import modules dynamically
        const watcherModule = await import('../../src/services/file-watcher');
        const workerModule = await import('../../src/workers/transcription-worker');
        const queueModule = await import('../../src/services/queue');

        FileWatcherService = watcherModule.FileWatcherService;
        TranscriptionWorker = workerModule.TranscriptionWorker;
        transcriptionQueue = queueModule.transcriptionQueue;

        fileWatcher = new FileWatcherService();
        worker = new TranscriptionWorker();

        // Clear mocks
        mockLogger.info.mockClear();
        mockQueueInstance.add.mockClear();
        mockFasterWhisperService.transcribe.mockClear();
        mockFileTracker.markProcessed.mockClear();

        // Initialize queue
        await transcriptionQueue.initialize();
    });

    it('should process a file from detection to transcription', async () => {
        // 1. Start components
        await fileWatcher.start();
        await worker.start();

        // 2. Simulate file addition
        const filePath = '/test/watch/test.wav';

        // Trigger the 'add' event handler manually since we mocked chokidar
        await (fileWatcher as any).handleFileAdded(filePath);

        // 3. Verify Job Creation
        expect(mockQueueInstance.add).toHaveBeenCalled();
        expect(mockFileTracker.markProcessed).toHaveBeenCalledWith(filePath, expect.any(String));

        // 4. Simulate Worker Processing
        const mockJob = {
            id: 'job-123',
            data: {
                fileName: 'test.wav',
                filePath: filePath,
                fileSize: 1024,
                mimeType: 'audio/wav',
                priority: 1,
                metadata: {
                    originalPath: filePath,
                    audioFormat: 'wav',
                    whisperModel: 'base',
                }
            },
            updateProgress: mock(async () => { }),
        };

        const result = await (worker as any).processJob(mockJob);

        // 5. Verify Transcription
        expect(result.success).toBe(true);
        expect(mockFasterWhisperService.transcribe).toHaveBeenCalled();
        expect(mockFs.rename).toHaveBeenCalled(); // Move to completed
        expect(mockJob.updateProgress).toHaveBeenCalledWith(100);
    });
});
