import { createHash } from 'crypto';

/**
 * Generate a deterministic job ID based on file metadata.
 * This ensures that the same file (same path, size, and mtime) always gets the same Job ID,
 * preventing duplicate processing.
 * 
 * @param filePath Absolute path to the file
 * @param fileSize Size of the file in bytes
 * @param mtime Modification time of the file
 * @returns MD5 hash string to be used as Job ID
 */
export function generateDeterministicJobId(filePath: string, fileSize: number, mtime: Date): string {
    // Create a unique hash based on file path, size, and modification time
    // If any of these change, it's considered a new version of the file
    const input = `${filePath}:${fileSize}:${mtime.getTime()}`;
    return createHash('md5').update(input).digest('hex');
}
