/**
 * Tests for RetentionService — the time-based cleanup of archive/ and
 * duplicates/ that Phase 3 added to bound disk growth.
 */

import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RetentionService } from '../../src/services/retention.js';

describe('RetentionService', () => {
  let root: string;
  let archiveDir: string;
  let duplicatesDir: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'palantir-retention-'));
    archiveDir = join(root, 'archive');
    duplicatesDir = join(root, 'duplicates');
    await mkdir(archiveDir, { recursive: true });
    await mkdir(duplicatesDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Clear both trees between tests
    for (const dir of [archiveDir, duplicatesDir]) {
      const entries = await readdir(dir);
      for (const e of entries) {
        await rm(join(dir, e), { recursive: true, force: true });
      }
    }
  });

  /** Set a file's mtime to N days ago. */
  async function ageFile(path: string, days: number): Promise<void> {
    const past = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    await utimes(path, past, past);
  }

  it('deletes archive files older than the threshold and keeps newer ones', async () => {
    const oldFile = join(archiveDir, '2024-01', 'old.ogg');
    const newFile = join(archiveDir, '2026-05', 'new.ogg');
    await mkdir(join(archiveDir, '2024-01'), { recursive: true });
    await mkdir(join(archiveDir, '2026-05'), { recursive: true });
    await writeFile(oldFile, Buffer.from('old-bytes'));
    await writeFile(newFile, Buffer.from('new-bytes'));
    await ageFile(oldFile, 200); // 200 days old
    await ageFile(newFile, 1);   // 1 day old

    const svc = new RetentionService(archiveDir, duplicatesDir, 180, 30);
    const report = await svc.runOnce();

    expect(report.archive.filesDeleted).toBe(1);
    expect(report.archive.bytesReclaimed).toBe(9);
    // Old file gone, new file preserved
    await expect(stat(oldFile)).rejects.toThrow();
    await expect(stat(newFile)).resolves.toBeDefined();
  });

  it('deletes duplicates files older than the threshold', async () => {
    const oldDup = join(duplicatesDir, 'sha-A', 'old-dup.ogg');
    const newDup = join(duplicatesDir, 'sha-B', 'recent-dup.ogg');
    await mkdir(join(duplicatesDir, 'sha-A'), { recursive: true });
    await mkdir(join(duplicatesDir, 'sha-B'), { recursive: true });
    await writeFile(oldDup, Buffer.from('old'));
    await writeFile(newDup, Buffer.from('recent'));
    await ageFile(oldDup, 60);
    await ageFile(newDup, 5);

    const svc = new RetentionService(archiveDir, duplicatesDir, 180, 30);
    const report = await svc.runOnce();

    expect(report.duplicates.filesDeleted).toBe(1);
    await expect(stat(oldDup)).rejects.toThrow();
    await expect(stat(newDup)).resolves.toBeDefined();
  });

  it('collapses empty sha subdirectories after cleanup', async () => {
    const subdir = join(duplicatesDir, 'sha-X');
    await mkdir(subdir, { recursive: true });
    const filePath = join(subdir, 'lone-file.ogg');
    await writeFile(filePath, Buffer.from('x'));
    await ageFile(filePath, 60);

    const svc = new RetentionService(archiveDir, duplicatesDir, 180, 30);
    await svc.runOnce();

    // File gone, the now-empty sha subdir also collapsed
    await expect(stat(filePath)).rejects.toThrow();
    await expect(stat(subdir)).rejects.toThrow();
  });

  it('retention=0 disables cleanup for that tree', async () => {
    const oldFile = join(archiveDir, 'ancient.ogg');
    await writeFile(oldFile, Buffer.from('ancient'));
    await ageFile(oldFile, 999);

    const svc = new RetentionService(archiveDir, duplicatesDir, 0, 0);
    const report = await svc.runOnce();

    expect(report.archive.filesDeleted).toBe(0);
    expect(report.duplicates.filesDeleted).toBe(0);
    // File untouched
    await expect(stat(oldFile)).resolves.toBeDefined();
  });

  it('handles missing tree gracefully (e.g., never-populated archive)', async () => {
    const ghostDir = join(root, 'does-not-exist');
    const svc = new RetentionService(ghostDir, duplicatesDir, 180, 30);
    // Should not throw
    await expect(svc.runOnce()).resolves.toBeDefined();
  });

  it('idempotent — second run reports zero deletions', async () => {
    const oldFile = join(archiveDir, 'cleanable.ogg');
    await writeFile(oldFile, Buffer.from('clean-me'));
    await ageFile(oldFile, 200);

    const svc = new RetentionService(archiveDir, duplicatesDir, 180, 30);
    const first = await svc.runOnce();
    const second = await svc.runOnce();

    expect(first.archive.filesDeleted).toBe(1);
    expect(second.archive.filesDeleted).toBe(0);
  });
});
