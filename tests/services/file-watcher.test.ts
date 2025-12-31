import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileWatcherService } from '../../src/services/file-watcher';
import { fileTracker } from '../../src/services/file-tracker';
import { transcriptionQueue } from '../../src/services/queue';
import { appConfig } from '../../src/config/index';
import * as fsPromises from 'fs/promises';
import { join } from 'path';

// Mock dependencies
vi.mock('chokidar', () => ({
    default: {
        watch: vi.fn().mockReturnValue({
            on: vi.fn(),
            close: vi.fn(),
        }),
    },
}));

vi.mock('../../src/services/file-tracker', () => ({
    fileTracker: {
        connect: vi.fn(),
        isProcessed: vi.fn().mockResolvedValue(false),
        markProcessed: vi.fn(),
    },
}));

vi.mock('../../src/services/queue', () => ({
    transcriptionQueue: {
        addJob: vi.fn().mockResolvedValue({ id: 'job-123' }),
    },
}));

vi.mock('../../src/config/index', () => ({
    appConfig: {
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
    },
}));

vi.mock('fs/promises', () => ({
    stat: vi.fn(),
    access: vi.fn(),
    rename: vi.fn(),
    readdir: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        fatal: vi.fn(),
    },
}));

describe('FileWatcherService', () => {
    let watcher: FileWatcherService;

    beforeEach(() => {
        watcher = new FileWatcherService();
        vi.resetAllMocks();

        // Mock stat to return valid file stats by default
        (fsPromises.stat as any).mockResolvedValue({
            isFile: () => true,
            isDirectory: () => false,
            size: 1024 * 1024 * 5, // 5MB
            birthtime: new Date(),
            mtime: new Date(),
        });

        // Mock access to succeed
        (fsPromises.access as any).mockResolvedValue(undefined);
    });

    it('should sanitize unsafe filenames by renaming them', async () => {
        const unsafePath = '/test/watch/my audio file @#$.mp3';
        const expectedSafePath = '/test/watch/my_audio_file_.mp3';

        // Access private method for testing flow or trigger via handleFileAdded
        // We'll trigger via handleFileAdded
        await (watcher as any).handleFileAdded(unsafePath);

        expect(fsPromises.rename).toHaveBeenCalledWith(unsafePath, expectedSafePath);
        // Should NOT add job for the unsafe file (it returns early after rename)
        expect(transcriptionQueue.addJob).not.toHaveBeenCalled();
    });

    it('should process safe filenames without renaming', async () => {
        const safePath = '/test/watch/my_safe_file.mp3';

        await (watcher as any).handleFileAdded(safePath);

        expect(fsPromises.rename).not.toHaveBeenCalled();
        expect(transcriptionQueue.addJob).toHaveBeenCalled();
    });

    it('should handle rename failure by processing original file', async () => {
        const unsafePath = '/test/watch/bad file.mp3';

        // Mock rename to fail
        (fsPromises.rename as any).mockRejectedValue(new Error('Rename failed'));

        await (watcher as any).handleFileAdded(unsafePath);

        expect(fsPromises.rename).toHaveBeenCalled();
        // Should proceed to process the original file since rename failed
        expect(transcriptionQueue.addJob).toHaveBeenCalled();
    });

    it('should generate deterministic job IDs for the same file', async () => {
        const filePath = '/test/watch/duplicate.mp3';

        // First call
        await (watcher as any).handleFileAdded(filePath);
        const firstCallArgs = (transcriptionQueue.addJob as any).mock.calls[0][0];
        const firstJobId = firstCallArgs.id;

        // Reset mocks but keep the same file stats
        (transcriptionQueue.addJob as any).mockClear();
        (fileTracker.isProcessed as any).mockResolvedValue(false); // Simulate not processed yet to trigger job creation logic

        // Second call
        await (watcher as any).handleFileAdded(filePath);
        const secondCallArgs = (transcriptionQueue.addJob as any).mock.calls[0][0];
        const secondJobId = secondCallArgs.id;

        expect(firstJobId).toBeDefined();
        expect(firstJobId).toBe(secondJobId);
    });
});
