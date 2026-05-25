/**
 * Tests for WorkManagerService — Phase 2 private working tree.
 *
 * Validates the architectural separation that prevents the Syncthing
 * rename war: the working tree, archive, and duplicates directories
 * are private to Palantir and never seen by Syncthing.
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkManagerService } from '../../src/services/work-manager.js';

describe('WorkManagerService', () => {
  let root: string;
  let inbox: string;
  let wm: WorkManagerService;
  const SHA_A = '0'.repeat(64);
  const SHA_B = '1'.repeat(64);

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'palantir-wm-'));
    inbox = join(root, 'inbox');
    await writeFile(join(inbox + '.keepalive'), ''); // dummy
    wm = new WorkManagerService({
      workDir: join(root, 'work'),
      archiveDir: join(root, 'archive'),
      duplicatesDir: join(root, 'duplicates'),
    });
    await wm.ensureLayout();
    const { mkdir } = await import('node:fs/promises');
    await mkdir(inbox, { recursive: true });
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // Each test stages its own input under inbox/
  });

  it('ensureLayout creates work, archive, and duplicates directories (idempotent)', async () => {
    await wm.ensureLayout();
    await wm.ensureLayout(); // second call: should not throw
    const paths = wm.getPaths();
    const entries = await readdir(root);
    expect(entries).toContain('work');
    expect(entries).toContain('archive');
    expect(entries).toContain('duplicates');
    expect(paths.workDir).toBe(join(root, 'work'));
  });

  it('setupForJob copies inbox file into work/{sha}/source.{ext}', async () => {
    const inboxPath = join(inbox, 'session-1.ogg');
    const bytes = Buffer.from('audio-bytes-A-' + Date.now());
    await writeFile(inboxPath, bytes);

    const result = await wm.setupForJob(inboxPath, SHA_A);

    expect(result.workSha).toBe(SHA_A);
    expect(result.workPath).toBe(join(root, 'work', SHA_A, 'source.ogg'));

    // Original inbox file is left in place (worker hasn't run yet)
    const inboxStillExists = await readFile(inboxPath);
    expect(inboxStillExists).toEqual(bytes);

    // Work copy has identical bytes
    const workCopy = await readFile(result.workPath);
    expect(workCopy).toEqual(bytes);
  });

  it('setupForJob is idempotent — repeated calls return same path without re-copying', async () => {
    const inboxPath = join(inbox, 'session-2.ogg');
    await writeFile(inboxPath, Buffer.from('idempotent-test'));
    const first = await wm.setupForJob(inboxPath, SHA_B);
    const second = await wm.setupForJob(inboxPath, SHA_B);
    expect(first.workPath).toBe(second.workPath);
  });

  it('setupForJob rejects malformed SHA', async () => {
    const inboxPath = join(inbox, 'bad-sha.ogg');
    await writeFile(inboxPath, Buffer.from('x'));
    await expect(wm.setupForJob(inboxPath, 'not-a-sha')).rejects.toThrow(/Invalid SHA-256/);
  });

  it('archiveOnSuccess moves inbox file to archive/YYYY-MM/{sha}.{ext} and drops work dir', async () => {
    const sha = '2'.repeat(64);
    const inboxPath = join(inbox, 'archive-me.ogg');
    const bytes = Buffer.from('archive-bytes');
    await writeFile(inboxPath, bytes);
    await wm.setupForJob(inboxPath, sha);

    const result = await wm.archiveOnSuccess(inboxPath, sha);

    expect(result.archivedTo).not.toBeNull();
    expect(result.archivedTo!).toMatch(new RegExp(`archive/\\d{4}-\\d{2}/${sha}\\.ogg$`));
    // Inbox file is GONE (moved, not copied) — Syncthing will see the deletion
    await expect(readFile(inboxPath)).rejects.toThrow();
    // Archive file has the bytes
    const archived = await readFile(result.archivedTo!);
    expect(archived).toEqual(bytes);
    // Work dir is cleaned up
    await expect(readdir(join(root, 'work', sha))).rejects.toThrow();
  });

  it('archiveOnSuccess is safe when inbox file is already gone (crash-recovery case)', async () => {
    const sha = '3'.repeat(64);
    // Stage a work dir without an inbox file
    const { mkdir, writeFile: wf } = await import('node:fs/promises');
    await mkdir(join(root, 'work', sha), { recursive: true });
    await wf(join(root, 'work', sha, 'source.ogg'), 'x');

    const result = await wm.archiveOnSuccess(join(inbox, 'never-existed.ogg'), sha);
    expect(result.archivedTo).toBeNull();
    // Work dir still cleaned up
    await expect(readdir(join(root, 'work', sha))).rejects.toThrow();
  });

  it('quarantineDuplicate moves inbox file out of the Syncthing tree', async () => {
    const sha = '4'.repeat(64);
    const inboxPath = join(inbox, 'duplicate-of-something.ogg');
    await writeFile(inboxPath, Buffer.from('dup-bytes'));

    const result = await wm.quarantineDuplicate(inboxPath, sha);

    expect(result.quarantinedTo).toContain(join(root, 'duplicates', sha));
    expect(result.quarantinedTo).toMatch(/duplicate-of-something\.ogg$/);
    await expect(readFile(inboxPath)).rejects.toThrow();
    expect((await readFile(result.quarantinedTo)).toString()).toBe('dup-bytes');
  });

  it('listOrphanedWorkDirs returns sha-named subdirectories of work/', async () => {
    const sha = '5'.repeat(64);
    const { mkdir, writeFile: wf } = await import('node:fs/promises');
    await mkdir(join(root, 'work', sha), { recursive: true });
    await wf(join(root, 'work', sha, 'source.ogg'), 'x');
    // Also create a non-sha entry that should NOT be returned
    await mkdir(join(root, 'work', 'not-a-sha'), { recursive: true });

    const orphans = await wm.listOrphanedWorkDirs();
    expect(orphans).toContain(sha);
    expect(orphans).not.toContain('not-a-sha');
  });
});
