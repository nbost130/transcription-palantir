/**
 * 🔮 Transcription Palantir - Retention Service
 *
 * Phase 3: time-based cleanup of /archive/ and /duplicates/ so they don't
 * grow unbounded. The audit caught this gap — Phase 2 created these dirs
 * but never planned their decay.
 *
 * Thresholds via env (sensible defaults):
 *   ARCHIVE_RETENTION_DAYS    default 180 (six months — long enough that
 *                              you can re-transcribe with a better model
 *                              if needed, short enough to prevent unbounded growth)
 *   DUPLICATES_RETENTION_DAYS default 30  (just long enough for forensic
 *                              comparison after a quarantine event)
 *
 * Behaviour:
 *   - Walks each tree, deletes any file (or its containing per-sha subdir
 *     once empty) whose mtime is older than the threshold.
 *   - Idempotent. Safe to run repeatedly. Logs counts every run.
 *   - Set retention to 0 to disable cleanup for a tree (defensive default
 *     for testing or paranoid mode).
 *
 * Wired into the lifecycle via node-cron (registered in index.ts), runs
 * once a day at 04:00. Also exposed as POST /api/v1/system/cleanup so
 * the operator can trigger it on demand.
 */

import { readdir, rm, rmdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { appConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface RetentionReport {
  scannedAt: string;
  archive: { thresholdDays: number; filesDeleted: number; bytesReclaimed: number };
  duplicates: { thresholdDays: number; filesDeleted: number; bytesReclaimed: number };
}

export class RetentionService {
  constructor(
    private archiveDir: string = appConfig.processing.archiveDirectory,
    private duplicatesDir: string = appConfig.processing.duplicatesDirectory,
    private archiveDays: number = numberFromEnv('ARCHIVE_RETENTION_DAYS', 180),
    private duplicatesDays: number = numberFromEnv('DUPLICATES_RETENTION_DAYS', 30)
  ) {}

  /** Run a single cleanup pass over both trees and return a structured report. */
  async runOnce(): Promise<RetentionReport> {
    const report: RetentionReport = {
      scannedAt: new Date().toISOString(),
      archive: { thresholdDays: this.archiveDays, filesDeleted: 0, bytesReclaimed: 0 },
      duplicates: { thresholdDays: this.duplicatesDays, filesDeleted: 0, bytesReclaimed: 0 },
    };

    if (this.archiveDays > 0) {
      const r = await this.cleanupTree(this.archiveDir, this.archiveDays);
      report.archive.filesDeleted = r.filesDeleted;
      report.archive.bytesReclaimed = r.bytesReclaimed;
    }

    if (this.duplicatesDays > 0) {
      const r = await this.cleanupTree(this.duplicatesDir, this.duplicatesDays);
      report.duplicates.filesDeleted = r.filesDeleted;
      report.duplicates.bytesReclaimed = r.bytesReclaimed;
    }

    logger.info({ report }, '🧹 Retention cleanup pass complete');
    return report;
  }

  /**
   * Walk a tree, delete files older than thresholdDays. Empty directories
   * are then collapsed up to (but not including) the tree root, so we
   * don't leave hundreds of empty per-sha directories behind.
   */
  private async cleanupTree(
    rootDir: string,
    thresholdDays: number
  ): Promise<{ filesDeleted: number; bytesReclaimed: number }> {
    const cutoffMs = Date.now() - thresholdDays * 24 * 60 * 60 * 1000;
    let filesDeleted = 0;
    let bytesReclaimed = 0;

    // Phase A — walk the tree and delete files older than the threshold.
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: recursive walk with error handling — splitting would obscure intent
    const deleteOldFiles = async (dir: string): Promise<void> => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (err: any) {
        if (err?.code === 'ENOENT') return;
        throw err;
      }
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          await deleteOldFiles(path);
        } else if (entry.isFile()) {
          try {
            const s = await stat(path);
            if (s.mtimeMs < cutoffMs) {
              await rm(path, { force: true });
              filesDeleted++;
              bytesReclaimed += s.size;
            }
          } catch (err) {
            logger.warn({ err, path }, 'Retention: failed to inspect/delete file');
          }
        }
      }
    };

    // Phase B — walk again, removing empty subdirectories bottom-up.
    // Never touches rootDir itself.
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: recursive walk with error handling — splitting would obscure intent
    const collapseEmptyDirs = async (dir: string): Promise<void> => {
      let entries: import('node:fs').Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (err: any) {
        if (err?.code === 'ENOENT') return;
        throw err;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await collapseEmptyDirs(join(dir, entry.name));
        }
      }
      if (dir !== rootDir) {
        try {
          const remaining = await readdir(dir);
          if (remaining.length === 0) {
            await rmdir(dir);
          }
        } catch {
          // dir not empty or already gone — ignore
        }
      }
    };

    await deleteOldFiles(rootDir);
    await collapseEmptyDirs(rootDir);
    return { filesDeleted, bytesReclaimed };
  }
}

function numberFromEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const retentionService = new RetentionService();
