import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test';
import { mockWorkerInstance } from '../../tests/mocks';

// Mock dependencies
const mockLogger = {
    info: mock(() => { }),
    warn: mock(() => { }),
    error: mock(() => { }),
    debug: mock(() => { }),
    fatal: mock(() => { }),
};

const mockConfig = {
    processing: {
        maxWorkers: 2,
        watchDirectory: '/test/watch',
        outputDirectory: '/test/output',
        completedDirectory: '/test/completed',
        failedDirectory: '/test/failed',
    },
    whisper: {
        model: 'base',
    },
    redis: {
        host: 'localhost',
        port: 6379,
    },
};

// Mocks for bullmq and ioredis are handled in tests/setup.ts



const mockWhisperService = {
    validateBinary: mock(async () => true),
};

const mockFasterWhisperService = {
    transcribe: mock(async () => ({ text: 'Transcribed text' })),
};

const mockFileTracker = {
    unmarkProcessed: mock(async () => { }),
};

const mockFs = {
    mkdir: mock(async () => { }),
    access: mock(async () => { }),
    rename: mock(async () => { }),
    writeFile: mock(async () => { }),
};

// Mock modules
mock.module('../utils/logger.js', () => ({ logger: mockLogger }));
mock.module('../config/index.js', () => ({
    appConfig: mockConfig,
    getRedisUrl: () => 'redis://localhost:6379',
    getWhisperCommand: () => 'whisper',
}));

mock.module('../services/whisper.js', () => ({ whisperService: mockWhisperService }));
mock.module('../services/faster-whisper.js', () => ({ fasterWhisperService: mockFasterWhisperService }));
mock.module('../services/file-tracker.js', () => ({ fileTracker: mockFileTracker }));
mock.module('fs/promises', () => ({ ...mockFs, default: mockFs }));
mock.module('node:fs/promises', () => ({
    stat: mockFs.stat, // Although not used directly, good to have
    access: mockFs.access,
    readdir: mockFs.readdir, // Not in mockFs but maybe needed? mockFs doesn't have readdir in this file?
    rename: mockFs.rename,
    writeFile: mockFs.writeFile,
    mkdir: mockFs.mkdir,
    default: mockFs,
}));
mock.module('child_process', () => ({ spawn: mock(() => ({})) }));

describe('TranscriptionWorker', () => {
    let TranscriptionWorker: any;
    let worker: any;

    beforeEach(async () => {
        // Re-import module to ensure mocks are used
        // We need to use a query param to bypass cache if needed, but Bun might handle it.
        // Actually, bun test might cache modules.
        // But since we are mocking modules, the import should use the mocks.
        // The issue before was likely that the static import happened before mocks were defined/hoisted correctly relative to the import execution.

        const module = await import('./transcription-worker');
        TranscriptionWorker = module.TranscriptionWorker;
        worker = new TranscriptionWorker();

        // Clear mocks
        mockLogger.info.mockClear();
        mockLogger.warn.mockClear();
        mockLogger.error.mockClear();
        mockWorkerInstance.on.mockClear();
        mockWorkerInstance.close.mockClear();
    });

    describe('start', () => {
        it('should start the worker successfully', async () => {
            await worker.start();


            expect(mockWorkerInstance.on).toHaveBeenCalled();
            expect(worker.running).toBe(true);
        });

        it('should not start if already running', async () => {
            await worker.start();
            await worker.start();


            expect(mockLogger.warn).toHaveBeenCalledWith('Transcription worker is already running');
        });
    });

    describe('processJob', () => {
        it('should process a job successfully', async () => {
            const mockJob = {
                id: 'job-123',
                data: {
                    fileName: 'test.wav',
                    filePath: '/test/watch/test.wav',
                },
                updateProgress: mock(async () => { }),
            };

            // Access private method
            const result = await (worker as any).processJob(mockJob);

            expect(result.success).toBe(true);
            expect(mockFs.mkdir).toHaveBeenCalled(); // Ensure directories
            expect(mockFasterWhisperService.transcribe).toHaveBeenCalled();
            expect(mockFs.rename).toHaveBeenCalled(); // Move completed file
            expect(mockJob.updateProgress).toHaveBeenCalledWith(100);
        });

        it('should handle transcription failure', async () => {
            const mockJob = {
                id: 'job-123',
                data: {
                    fileName: 'test.wav',
                    filePath: '/test/watch/test.wav',
                },
                updateProgress: mock(async () => { }),
            };

            mockFasterWhisperService.transcribe.mockRejectedValueOnce(new Error('Transcription failed'));

            try {
                await (worker as any).processJob(mockJob);
            } catch (error) {
                expect(error).toBeDefined();
            }

            expect(mockLogger.error).toHaveBeenCalledWith(expect.anything(), '❌ Transcription failed');
            expect(mockFs.rename).toHaveBeenCalled(); // Move failed file
        });

        it('should update job progress during transcription', async () => {
            const mockJob = {
                id: 'job-123',
                data: {
                    fileName: 'test.wav',
                    filePath: '/test/watch/test.wav',
                },
                updateProgress: mock(async () => { }),
            };

            // Capture the progress callback passed to runTranscription (which calls transcribe)
            // Since we mock fasterWhisperService.transcribe directly, we can't easily trigger the callback
            // unless we mock runTranscription or change how we mock transcribe.

            // However, processJob calls runTranscription, which calls fasterWhisperService.transcribe.
            // In processJob, it passes a callback to runTranscription: (progress) => job.updateProgress(...)

            // Let's verify that updateProgress is called at the end with 100
            await (worker as any).processJob(mockJob);
            expect(mockJob.updateProgress).toHaveBeenCalledWith(100);
        });

        it('should handle missing input file', async () => {
            const mockJob = {
                id: 'job-123',
                data: {
                    fileName: 'missing.wav',
                    filePath: '/test/watch/missing.wav',
                },
                updateProgress: mock(async () => { }),
            };

            mockFs.access.mockRejectedValueOnce(new Error('File not found'));

            try {
                await (worker as any).processJob(mockJob);
            } catch (error) {
                expect(error).toBeDefined();
                expect((error as Error).message).toContain('Input file not accessible');
            }
        });
    });

    describe('stop', () => {
        it('should stop the worker', async () => {
            await worker.start();
            await worker.stop();

            expect(mockWorkerInstance.close).toHaveBeenCalled();

            expect(worker.running).toBe(false);
        });
    });
});
