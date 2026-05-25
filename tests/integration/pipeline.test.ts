/**
 * Phase 3 integration test — exercises WorkManager + FileTracker +
 * MetricsService together (without BullMQ/Redis) to validate the
 * lifecycle: stage → archive on success → dedup → quarantine.
 *
 * Mocks the actual whisper call. Everything else runs for real.
 */

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkManagerService } from '../../src/services/work-manager.js';
import { MetricsService } from '../../src/services/metrics.js';

describe('Pipeline integration — stage / dedup / archive lifecycle', () => {
  let root: string;
  let inboxDir: string;
  let workDir: string;
  let archiveDir: string;
  let duplicatesDir: string;
  let wm: WorkManagerService;
  let m: MetricsService;

  // Track SHAs we've "processed" — simulating the FileTracker without Redis
  const seenShas = new Set<string>();

  function sha256(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
  }

  /**
   * Simulates the file-watcher's handleFileAdded path without chokidar
   * or BullMQ. Returns the action taken: 'staged' | 'quarantined'.
   */
  async function processNewInboxFile(inboxPath: string): Promise<{
    action: 'staged' | 'quarantined';
    sha: string;
    workPath?: string;
  }> {
    const bytes = await readFile(inboxPath);
    const sha = sha256(bytes);

    if (seenShas.has(sha)) {
      await wm.quarantineDuplicate(inboxPath, sha);
      m.incrementDedupSaved();
      return { action: 'quarantined', sha };
    }

    const staged = await wm.setupForJob(inboxPath, sha);
    m.incrementJobsStaged();
    seenShas.add(sha);
    return { action: 'staged', sha, workPath: staged.workPath };
  }

  /** Simulates the worker's completed-event handler. */
  async function simulateTranscriptionSuccess(inboxPath: string, sha: string): Promise<void> {
    await wm.archiveOnSuccess(inboxPath, sha);
    m.incrementJobsArchived();
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'palantir-pipeline-'));
    inboxDir = join(root, 'inbox');
    workDir = join(root, 'work');
    archiveDir = join(root, 'archive');
    duplicatesDir = join(root, 'duplicates');
    await mkdir(inboxDir, { recursive: true });
    wm = new WorkManagerService({ workDir, archiveDir, duplicatesDir });
    await wm.ensureLayout();
    m = new MetricsService();
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  beforeEach(() => {
    seenShas.clear();
    m.reset();
  });

  it('full lifecycle: drop two unique files in same subdir → both stage → both archive → distinct work paths', async () => {
    const subdir = join(inboxDir, 'session-day-A');
    await mkdir(subdir, { recursive: true });
    const fileA = join(subdir, 'lesson-1.ogg');
    const fileB = join(subdir, 'lesson-2.ogg');
    await writeFile(fileA, Buffer.from('audio-A-unique-' + Date.now()));
    await writeFile(fileB, Buffer.from('audio-B-unique-' + Date.now()));

    const resultA = await processNewInboxFile(fileA);
    const resultB = await processNewInboxFile(fileB);

    expect(resultA.action).toBe('staged');
    expect(resultB.action).toBe('staged');
    // CRITICAL: distinct work paths — this is the regression Phase 2.5 fixed
    expect(resultA.workPath).not.toBe(resultB.workPath);
    expect(resultA.workPath!.endsWith('/lesson-1.ogg')).toBe(true);
    expect(resultB.workPath!.endsWith('/lesson-2.ogg')).toBe(true);

    // Simulate successful transcription of both
    await simulateTranscriptionSuccess(fileA, resultA.sha);
    await simulateTranscriptionSuccess(fileB, resultB.sha);

    // Inbox emptied
    await expect(readFile(fileA)).rejects.toThrow();
    await expect(readFile(fileB)).rejects.toThrow();
    // Both archived
    const archives = await readdir(join(archiveDir, new Date().toISOString().slice(0, 7)));
    expect(archives).toContain(`${resultA.sha}.ogg`);
    expect(archives).toContain(`${resultB.sha}.ogg`);
    // Work dirs cleaned up
    const workEntries = await readdir(workDir);
    expect(workEntries).not.toContain(resultA.sha);
    expect(workEntries).not.toContain(resultB.sha);
  });

  it('duplicate-content second drop quarantines without restarting transcription', async () => {
    const subdir = join(inboxDir, 'dup-test');
    await mkdir(subdir, { recursive: true });
    const fileA = join(subdir, 'first.ogg');
    const sharedBytes = Buffer.from('shared-content-' + Date.now());
    await writeFile(fileA, sharedBytes);

    const r1 = await processNewInboxFile(fileA);
    await simulateTranscriptionSuccess(fileA, r1.sha);

    // Drop the SAME bytes under a different name
    const fileB = join(subdir, 'second-different-name.ogg');
    await writeFile(fileB, sharedBytes);
    const r2 = await processNewInboxFile(fileB);

    expect(r2.action).toBe('quarantined');
    expect(r2.sha).toBe(r1.sha);
    // The duplicate is in /duplicates/{sha}/
    const dupEntries = await readdir(join(duplicatesDir, r2.sha));
    expect(dupEntries.length).toBe(1);
    expect(dupEntries[0]).toMatch(/second-different-name\.ogg$/);

    // Metrics: 1 stage, 1 archive, 1 dedup-saved
    const snap = await m.snapshot();
    expect(snap.counters.dedupSaved).toBeGreaterThanOrEqual(1);
  });

  it('weird filenames with spaces, parens, and ampersands survive end-to-end', async () => {
    const subdir = join(inboxDir, 'weird-names');
    await mkdir(subdir, { recursive: true });
    const weirdName = join(subdir, 'Holy Spirit & The Believer (2024-04-12).ogg');
    await writeFile(weirdName, Buffer.from('weird-name-bytes-' + Date.now()));

    const result = await processNewInboxFile(weirdName);
    expect(result.action).toBe('staged');
    // Work path must be filesystem-safe
    const workBasename = result.workPath!.split('/').pop()!;
    expect(workBasename).not.toMatch(/[ &()]/);
    expect(workBasename.endsWith('.ogg')).toBe(true);

    await simulateTranscriptionSuccess(weirdName, result.sha);
    // Archived under SHA name (so the weird filename never causes downstream pain)
    const monthDir = join(archiveDir, new Date().toISOString().slice(0, 7));
    const archived = await readdir(monthDir);
    expect(archived).toContain(`${result.sha}.ogg`);
  });

  it("metrics counters reflect the full pipeline behavior", async () => {
    const before = (await m.snapshot()).counters;
    const subdir = join(inboxDir, 'metric-test');
    await mkdir(subdir, { recursive: true });

    // Three unique files + one new (fresh-1) + one duplicate of fresh-1
    for (let i = 1; i <= 3; i++) {
      const p = join(subdir, `unique-${i}.ogg`);
      await writeFile(p, Buffer.from(`unique-content-${i}-${Date.now()}`));
      const r = await processNewInboxFile(p);
      await simulateTranscriptionSuccess(p, r.sha);
    }

    // The first file's bytes... we lost them after archiveOnSuccess moved
    // the inbox file out. Drop fresh duplicates of a known-staged SHA via
    // a second file that hashes to a previously-seen SHA. Recreate:
    const dupBytes = Buffer.from('dup-of-first');
    const dupFile = join(subdir, 'fresh-1.ogg');
    await writeFile(dupFile, dupBytes);
    const r1 = await processNewInboxFile(dupFile);
    await simulateTranscriptionSuccess(dupFile, r1.sha);

    const dupCopy = join(subdir, 'fresh-1-copy.ogg');
    await writeFile(dupCopy, dupBytes);
    const r2 = await processNewInboxFile(dupCopy);
    expect(r2.action).toBe('quarantined');

    const after = (await m.snapshot()).counters;
    expect(after.jobsStaged - before.jobsStaged).toBe(4); // 3 + the fresh-1
    expect(after.jobsArchived - before.jobsArchived).toBe(4); // all 4 transcribed
    expect(after.dedupSaved - before.dedupSaved).toBe(1); // fresh-1-copy
    expect(after.jobsFailed - before.jobsFailed).toBe(0);
  });
});
