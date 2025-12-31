import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReconciliationService } from '../../src/services/reconciliation';
import { TranscriptionQueue } from '../../src/services/queue';
import { AppConfig } from '../../src/types/index';
import * as fs from 'fs/promises';
import { logger } from '../../src/utils/logger';

// Mock dependencies
vi.mock('fs/promises', () => ({
    readdir: vi.fn(),
    unlink: vi.fn()
}));
vi.mock('../../src/utils/logger', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    }
}));

describe('ReconciliationService', () => {
    let service: ReconciliationService;
    let mockQueue: any;
    let mockConfig: AppConfig;

    beforeEach(() => {
        vi.resetAllMocks();

        mockQueue = {
            queueInstance: {
                getJobs: vi.fn().mockResolvedValue([])
            },
            addJob: vi.fn().mockResolvedValue({ id: 'new-job-id' })
        };

        mockConfig = {
            processing: {
                watchDirectory: '/inbox',
                outputDirectory: '/transcripts',
            },
            // ... other config
        } as any;

        service = new ReconciliationService(mockQueue as unknown as TranscriptionQueue, mockConfig);
    });

    it('should detect orphaned files and create jobs', async () => {
        // Setup: 2 files in inbox, 0 jobs in Redis
        (fs.readdir as any).mockResolvedValue(['file1.mp3', 'file2.mp3', 'not-audio.txt']);
        mockQueue.queueInstance.getJobs.mockResolvedValue([]); // No active jobs

        const report = await service.reconcileOnBoot();

        expect(report.filesScanned).toBe(2); // Only mp3s
        expect(report.jobsCreated).toBe(2);
        expect(mockQueue.addJob).toHaveBeenCalledTimes(2);
        expect(mockQueue.addJob).toHaveBeenCalledWith({ fileName: 'file1.mp3' });
        expect(mockQueue.addJob).toHaveBeenCalledWith({ fileName: 'file2.mp3' });
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[SELF-HEAL]'));
    });

    it('should ignore files that are already tracked', async () => {
        // Setup: 2 files in inbox, 1 job in Redis
        (fs.readdir as any).mockResolvedValue(['file1.mp3', 'file2.mp3']);
        mockQueue.queueInstance.getJobs.mockResolvedValue([
            { data: { fileName: 'file1.mp3' } }
        ]);

        const report = await service.reconcileOnBoot();

        expect(report.filesScanned).toBe(2);
        expect(report.jobsCreated).toBe(1); // Only file2.mp3 needs a job
        expect(report.jobsReconciled).toBe(1); // file1.mp3 was reconciled
        expect(mockQueue.addJob).toHaveBeenCalledTimes(1);
        expect(mockQueue.addJob).toHaveBeenCalledWith({ fileName: 'file2.mp3' });
    });

    it('should cleanup partial output files for restarted jobs', async () => {
        // Setup: 1 orphaned file
        (fs.readdir as any).mockResolvedValue(['orphaned.mp3']);
        mockQueue.queueInstance.getJobs.mockResolvedValue([]);

        // Mock unlink to succeed
        (fs.unlink as any).mockResolvedValue(undefined);

        await service.reconcileOnBoot();

        // Should attempt to delete .txt, .vtt, .json
        expect(fs.unlink).toHaveBeenCalledWith('/transcripts/orphaned.txt');
        expect(fs.unlink).toHaveBeenCalledWith('/transcripts/orphaned.vtt');
        expect(fs.unlink).toHaveBeenCalledWith('/transcripts/orphaned.json');
    });

    it('should handle errors gracefully', async () => {
        (fs.readdir as any).mockRejectedValue(new Error('Disk error'));

        await expect(service.reconcileOnBoot()).rejects.toThrow('Disk error');
        expect(logger.error).toHaveBeenCalled();
    });
});
