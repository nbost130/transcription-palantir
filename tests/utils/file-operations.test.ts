import { describe, it, expect, vi, beforeEach } from 'vitest';
import { atomicMove } from '../../src/utils/file-operations';
import * as fs from 'fs/promises';

vi.mock('fs/promises', () => ({
    rename: vi.fn(),
    copyFile: vi.fn(),
    unlink: vi.fn()
}));

describe('atomicMove', () => {
    const src = '/source/file.txt';
    const dest = '/dest/file.txt';

    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should use rename for same-filesystem moves', async () => {
        (fs.rename as any).mockResolvedValue(undefined);

        await atomicMove(src, dest);

        expect(fs.rename).toHaveBeenCalledWith(src, dest);
        expect(fs.copyFile).not.toHaveBeenCalled();
        expect(fs.unlink).not.toHaveBeenCalled();
    });

    it('should handle EXDEV by copy-rename-delete', async () => {
        // First rename fails with EXDEV
        const exdevError: any = new Error('Cross-device link');
        exdevError.code = 'EXDEV';
        (fs.rename as any)
            .mockRejectedValueOnce(exdevError) // First call fails
            .mockResolvedValue(undefined);     // Second call (temp -> dest) succeeds

        (fs.copyFile as any).mockResolvedValue(undefined);
        (fs.unlink as any).mockResolvedValue(undefined);

        await atomicMove(src, dest);

        expect(fs.rename).toHaveBeenNthCalledWith(1, src, dest);
        expect(fs.copyFile).toHaveBeenCalledWith(src, `${dest}.tmp`);
        expect(fs.rename).toHaveBeenNthCalledWith(2, `${dest}.tmp`, dest);
        expect(fs.unlink).toHaveBeenCalledWith(src);
    });

    it('should cleanup temp file if copy/rename fails during EXDEV handling', async () => {
        const exdevError: any = new Error('Cross-device link');
        exdevError.code = 'EXDEV';
        (fs.rename as any).mockRejectedValueOnce(exdevError);

        const copyError = new Error('Copy failed');
        (fs.copyFile as any).mockRejectedValue(copyError);

        await expect(atomicMove(src, dest)).rejects.toThrow('Copy failed');

        expect(fs.unlink).toHaveBeenCalledWith(`${dest}.tmp`);
    });

    it('should re-throw non-EXDEV errors', async () => {
        const otherError = new Error('Permission denied');
        (fs.rename as any).mockRejectedValue(otherError);

        await expect(atomicMove(src, dest)).rejects.toThrow('Permission denied');
        expect(fs.copyFile).not.toHaveBeenCalled();
    });
});
