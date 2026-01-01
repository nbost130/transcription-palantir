import { copyFile, rename, unlink } from 'node:fs/promises';

/**
 * Atomically moves a file from source to destination.
 * Handles cross-filesystem moves by falling back to copy+rename+delete.
 *
 * @param src Source file path
 * @param dest Destination file path
 */
export async function atomicMove(src: string, dest: string): Promise<void> {
  try {
    // Try fast atomic rename first
    await rename(src, dest);
  } catch (error: any) {
    if (error.code === 'EXDEV') {
      // Cross-filesystem move detected
      const tempDest = `${dest}.tmp`;

      try {
        // 1. Copy to temp file on destination FS
        // By default copyFile overwrites, which is what we want for the temp file
        await copyFile(src, tempDest);

        // 2. Atomically rename temp file to final destination
        await rename(tempDest, dest);

        // 3. Delete source file
        await unlink(src);
      } catch (innerError) {
        // Clean up temp file if it exists
        try {
          await unlink(tempDest);
        } catch (_cleanupError) {
          // Ignore cleanup errors (file might not exist yet)
        }
        throw innerError;
      }
    } else {
      // Re-throw other errors with context if possible, or just raw error
      // Ideally we'd wrap it but for now raw error is fine as per standard node behavior
      throw error;
    }
  }
}
