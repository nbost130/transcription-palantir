/**
 * 🔮 Transcription Palantir - Work Manager
 *
 * Owns Palantir's private working tree, archive, and duplicates directory —
 * all OUTSIDE the Syncthing-managed inbox so Syncthing never sees the
 * working state and cannot start a rename war with Palantir.
 *
 * Directory layout (all configurable; defaults below):
 *
 *   WORK_DIR        = /var/lib/palantir/work
 *   ARCHIVE_DIR     = /var/lib/palantir/archive
 *   DUPLICATES_DIR  = /var/lib/palantir/duplicates
 *
 * Lifecycle:
 *   1. Intake sees new file in inbox (Syncthing drop)
 *   2. Compute SHA, check dedup
 *   3a. Dup hit  → quarantineDuplicate(): MOVE inbox file to duplicates/
 *   3b. New SHA  → setupForJob(): COPY inbox file to work/{sha}/source.{ext}
 *   4. Worker reads from work/{sha}/source.{ext}; writes work/{sha}/transcript.*
 *   5. On success → archiveOnSuccess(): MOVE inbox source to archive/{YYYY-MM}/{sha}.{ext},
 *                                       drop work/{sha}/
 *   6. On failure → leave work/{sha}/ in place for retry; inbox file untouched
 *
 * Atomic transitions: all mutations use rename(2) (same filesystem) where
 * possible, and write-tmp-then-rename for new content.
 */

import { constants } from 'node:fs';
import { access, copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { appConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface WorkPaths {
  workDir: string;
  archiveDir: string;
  duplicatesDir: string;
}

export interface SetupResult {
  workPath: string;   // /var/lib/palantir/work/{sha}/source.{ext}
  workSha: string;
  workDirForJob: string; // /var/lib/palantir/work/{sha}
}

export class WorkManagerService {
  constructor(private readonly paths: WorkPaths = defaultPaths()) {}

  /**
   * Idempotent — safe to call repeatedly. Creates the three top-level dirs.
   */
  async ensureLayout(): Promise<void> {
    await Promise.all([
      mkdir(this.paths.workDir, { recursive: true }),
      mkdir(this.paths.archiveDir, { recursive: true }),
      mkdir(this.paths.duplicatesDir, { recursive: true }),
    ]);
  }

  /**
   * Stage an inbox file for processing. Copies (not moves) the file into the
   * private working tree at work/{sha}/source.{ext}. The inbox file is left
   * in place until archiveOnSuccess() runs — so a worker crash doesn't lose
   * the source.
   *
   * Idempotent: if work/{sha}/source.{ext} already exists, returns it without
   * re-copying. Caller responsible for SHA verification upstream.
   */
  async setupForJob(inboxPath: string, sha: string): Promise<SetupResult> {
    if (!/^[0-9a-f]{64}$/.test(sha)) {
      throw new Error(`Invalid SHA-256 (expected 64 hex chars): ${sha}`);
    }

    const ext = extname(inboxPath).toLowerCase() || '.bin';
    const workDirForJob = join(this.paths.workDir, sha);
    const workPath = join(workDirForJob, `source${ext}`);

    await mkdir(workDirForJob, { recursive: true });

    // Idempotent fast-path
    try {
      await access(workPath, constants.R_OK);
      logger.debug({ sha, workPath }, 'Work staging already exists, reusing');
      return { workPath, workSha: sha, workDirForJob };
    } catch {
      // Not staged yet — proceed
    }

    // Write to .tmp then rename (atomic-on-same-fs). Same-filesystem requirement
    // satisfied because workDir is a single tree.
    const tmpPath = `${workPath}.tmp.${process.pid}`;
    await copyFile(inboxPath, tmpPath);
    await rename(tmpPath, workPath);
    logger.info({ sha, inboxPath, workPath }, '📥 Staged inbox file into working tree');

    return { workPath, workSha: sha, workDirForJob };
  }

  /**
   * On successful transcription: MOVE the original inbox file out of the
   * Syncthing-watched tree into the archive. Drop the per-job work directory.
   *
   * Archive layout: archive/{YYYY-MM}/{sha}.{ext}. The SHA is the canonical
   * name — no filename collisions possible.
   *
   * If the inbox file is gone (already archived in a prior crash-resumed
   * attempt) this is a no-op for the move; the work-dir cleanup still runs.
   */
  async archiveOnSuccess(inboxPath: string | undefined, sha: string): Promise<{ archivedTo: string | null }> {
    if (!/^[0-9a-f]{64}$/.test(sha)) {
      throw new Error(`Invalid SHA-256: ${sha}`);
    }

    let archivedTo: string | null = null;
    if (inboxPath) {
      try {
        await access(inboxPath, constants.R_OK);
        const ext = extname(inboxPath).toLowerCase() || '.bin';
        const yyyyMm = new Date().toISOString().slice(0, 7); // 2026-05
        const monthDir = join(this.paths.archiveDir, yyyyMm);
        await mkdir(monthDir, { recursive: true });
        archivedTo = join(monthDir, `${sha}${ext}`);
        try {
          // Try rename first — same FS, atomic and free
          await rename(inboxPath, archivedTo);
        } catch (renameErr: any) {
          if (renameErr?.code === 'EXDEV') {
            // Cross-device — fall back to copy+unlink
            await copyFile(inboxPath, archivedTo);
            await rm(inboxPath, { force: true });
          } else {
            throw renameErr;
          }
        }
        logger.info({ sha, inboxPath, archivedTo }, '📦 Archived inbox source');
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          logger.warn({ sha, inboxPath }, 'Inbox source already gone at archive time — skipping move');
        } else {
          logger.error({ err, sha, inboxPath }, 'Failed to archive inbox source');
        }
      }
    }

    // Clean up the per-job work dir regardless of archive outcome.
    const workDirForJob = join(this.paths.workDir, sha);
    try {
      await rm(workDirForJob, { recursive: true, force: true });
      logger.debug({ sha, workDirForJob }, 'Cleaned up work dir');
    } catch (err) {
      logger.warn({ err, sha, workDirForJob }, 'Failed to clean up work dir');
    }

    return { archivedTo };
  }

  /**
   * Inbox file's content matches an already-processed SHA. Move it out of the
   * Syncthing-watched tree so the daily re-sync stops re-detecting it.
   *
   * Destination: duplicates/{sha}/{timestamp}-{basename}. Keeps the original
   * filename for forensic value. Multiple copies of the same SHA accumulate
   * inside the per-SHA subdir.
   */
  async quarantineDuplicate(inboxPath: string, sha: string): Promise<{ quarantinedTo: string }> {
    if (!/^[0-9a-f]{64}$/.test(sha)) {
      throw new Error(`Invalid SHA-256: ${sha}`);
    }

    const dupDirForSha = join(this.paths.duplicatesDir, sha);
    await mkdir(dupDirForSha, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = basename(inboxPath).replace(/[^a-zA-Z0-9._-]/g, '_');
    const dest = join(dupDirForSha, `${stamp}-${safeName}`);

    try {
      await rename(inboxPath, dest);
    } catch (err: any) {
      if (err?.code === 'EXDEV') {
        await copyFile(inboxPath, dest);
        await rm(inboxPath, { force: true });
      } else {
        throw err;
      }
    }

    logger.info({ sha, inboxPath, quarantinedTo: dest }, '♻️ Quarantined duplicate (content already processed)');
    return { quarantinedTo: dest };
  }

  /**
   * On boot, return any SHAs that have a work/{sha}/ directory — i.e., jobs
   * that were staged but not finished archiving. Caller is responsible for
   * deciding whether to resume or drop them.
   *
   * Replacement for ReconciliationService boot-scan-of-inbox. The queue (Redis)
   * is now the source of truth for what's enqueued; this method only surfaces
   * the disk side-effect of in-flight work for recovery decisions.
   */
  async listOrphanedWorkDirs(): Promise<string[]> {
    try {
      await access(this.paths.workDir, constants.R_OK);
    } catch {
      return [];
    }
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(this.paths.workDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && /^[0-9a-f]{64}$/.test(e.name)).map((e) => e.name);
  }

  /** Paths accessor for tests / debugging. */
  getPaths(): WorkPaths {
    return { ...this.paths };
  }
}

function defaultPaths(): WorkPaths {
  return {
    workDir: appConfig.processing.workDirectory,
    archiveDir: appConfig.processing.archiveDirectory,
    duplicatesDir: appConfig.processing.duplicatesDirectory,
  };
}

export const workManager = new WorkManagerService();
