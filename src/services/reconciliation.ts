import { readdir, unlink } from 'fs/promises';
import { join, parse } from 'path';
import { AppConfig } from '../types/index.js';
import { TranscriptionQueue } from './queue';
import { logger } from '../utils/logger';

export interface ReconciliationReport {
    filesScanned: number;
    jobsCreated: number;
    partialFilesDeleted: number;
    jobsReconciled: number;
}

export class ReconciliationService {
    constructor(
        private queue: TranscriptionQueue,
        private config: AppConfig
    ) { }

    /**
     * Reconciles disk state with Redis state on boot.
     * 1. Scans Inbox for files
     * 2. Checks if they exist in Redis (Waiting/Processing)
     * 3. Creates jobs for orphaned files
     * 4. Cleans up partial outputs for restarted jobs
     */
    async reconcileOnBoot(): Promise<ReconciliationReport> {
        logger.info('Starting boot reconciliation...');

        const report: ReconciliationReport = {
            filesScanned: 0,
            jobsCreated: 0,
            partialFilesDeleted: 0,
            jobsReconciled: 0
        };

        try {
            // 1. Scan Inbox
            const files = await readdir(this.config.processing.watchDirectory);
            const mp3Files = files.filter(f => f.toLowerCase().endsWith('.mp3'));
            report.filesScanned = mp3Files.length;

            // 2. Get active jobs from Redis
            // We need to check both Waiting and Processing states
            // Note: This is an approximation. For perfect accuracy we'd need to check all jobs,
            // but checking active ones is usually sufficient for boot recovery.
            const activeJobs = await this.queue.queueInstance.getJobs(['waiting', 'active', 'delayed']);

            // Create a map of normalized filenames to job IDs for quick lookup
            // We assume job.data.originalName or job.name holds the filename
            const trackedFiles = new Set<string>();
            for (const job of activeJobs) {
                if (job.data && job.data.fileName) {
                    trackedFiles.add(job.data.fileName);
                }
            }

            // 3. Reconcile
            for (const filename of mp3Files) {
                if (!trackedFiles.has(filename)) {
                    // Orphaned file found!
                    logger.warn(`[SELF-HEAL] Found orphaned file: ${filename}. Creating job...`);

                    await this.queue.addJob({ fileName: filename });
                    report.jobsCreated++;

                    // 4. Cleanup partial outputs (if any existed from a previous attempt)
                    await this.cleanupPartialOutputs(filename);
                } else {
                    report.jobsReconciled++;
                }
            }

            logger.info({ report }, 'Boot reconciliation complete');
            return report;

        } catch (error) {
            logger.error({ err: error }, 'Failed to run boot reconciliation');
            throw error;
        }
    }

    /**
     * Deletes partial transcript files (.txt, .vtt) for a given audio filename.
     */
    private async cleanupPartialOutputs(filename: string): Promise<void> {
        const baseName = parse(filename).name;
        const extensions = ['.txt', '.vtt', '.json']; // Common output formats

        for (const ext of extensions) {
            const outputName = `${baseName}${ext}`;
            const outputPath = join(this.config.processing.outputDirectory, outputName);

            try {
                await unlink(outputPath);
                logger.warn(`[SELF-HEAL] Deleted partial output file: ${outputName}`);
                // We don't track this count in the main loop to keep it simple, 
                // but could add it if needed. For now just logging.
            } catch (error: any) {
                // Ignore ENOENT (file not found), throw others
                if (error.code !== 'ENOENT') {
                    logger.warn({ err: error, file: outputName }, 'Failed to delete partial output file');
                }
            }
        }
    }
}
