/**
 * Regression tests for FileTrackerService.
 *
 * The bug: prior to this PR, getFileHash() hashed `path:size:mtime`,
 * not file contents. Two identical-byte files at different paths
 * (Syncthing rename war, daily-resync, etc.) produced different
 * hashes and both transcribed. These tests fail without the fix.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FileTrackerService } from '../../src/services/file-tracker.js';

const skipIfNoRedis = process.env.SKIP_REDIS_TESTS === '1';

describe.skipIf(skipIfNoRedis)('FileTrackerService - content hash dedup', () => {
  let tracker: FileTrackerService;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'palantir-test-'));
    tracker = new FileTrackerService();
    await tracker.connect();
  });

  afterAll(async () => {
    await tracker.disconnect();
    await rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    // No-op: each test uses unique file paths and unique content
  });

  it('produces identical hashes for identical byte content at different paths', async () => {
    const bytes = Buffer.from('the quick brown fox jumps over the lazy dog');
    const pathA = join(tmpDir, 'recording-1-original.ogg');
    const pathB = join(tmpDir, '2006-recording-1-sanitized.ogg');
    await writeFile(pathA, bytes);
    await writeFile(pathB, bytes);

    const hashA = await tracker.getContentHash(pathA);
    const hashB = await tracker.getContentHash(pathB);

    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different byte content', async () => {
    const pathA = join(tmpDir, 'different-a.ogg');
    const pathB = join(tmpDir, 'different-b.ogg');
    await writeFile(pathA, Buffer.from('audio-payload-A'));
    await writeFile(pathB, Buffer.from('audio-payload-B'));

    const hashA = await tracker.getContentHash(pathA);
    const hashB = await tracker.getContentHash(pathB);

    expect(hashA).not.toBe(hashB);
  });

  it('marks a file processed once, then recognises its content under any other name', async () => {
    const bytes = Buffer.from('regression-bytes-' + Date.now());
    const original = join(tmpDir, `dup-original-${Date.now()}.ogg`);
    const sanitized = join(tmpDir, `dup-2006-${Date.now()}.ogg`);
    await writeFile(original, bytes);
    await writeFile(sanitized, bytes);

    expect(await tracker.isProcessed(original)).toBe(false);
    expect(await tracker.isProcessed(sanitized)).toBe(false);

    await tracker.markProcessed(original, 'job-test-1');

    // Same path — fast positive
    expect(await tracker.isProcessed(original)).toBe(true);
    // Different path, same bytes — content-hash positive (THIS is the regression test)
    expect(await tracker.isProcessed(sanitized)).toBe(true);

    await tracker.unmarkProcessed(original);
    expect(await tracker.isProcessed(original)).toBe(false);
    expect(await tracker.isProcessed(sanitized)).toBe(false);
  });

  it('caches hashes per (path, size, mtime) so repeated lookups are cheap', async () => {
    const bytes = Buffer.from('cache-test-' + Date.now());
    const path = join(tmpDir, `cache-${Date.now()}.ogg`);
    await writeFile(path, bytes);

    const start = Date.now();
    const h1 = await tracker.getContentHash(path);
    const firstDuration = Date.now() - start;

    const cachedStart = Date.now();
    const h2 = await tracker.getContentHash(path);
    const cachedDuration = Date.now() - cachedStart;

    expect(h1).toBe(h2);
    // Cached lookup should not require streaming again — generous bound.
    expect(cachedDuration).toBeLessThanOrEqual(firstDuration);
  });
});
