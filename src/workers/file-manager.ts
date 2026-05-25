import { constants } from 'node:fs';
import { access, mkdir, rename } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { appConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';

export class FileManager {
  async validateInputFile(filePath: string): Promise<void> {
    try {
      await access(filePath, constants.R_OK);
    } catch (_error) {
      throw new Error(`Input file not accessible: ${filePath}`);
    }
  }

  async ensureDirectories(): Promise<void> {
    const directories = [
      appConfig.processing.outputDirectory,
      appConfig.processing.completedDirectory,
      appConfig.processing.failedDirectory,
    ];

    for (const dir of directories) {
      await mkdir(dir, { recursive: true });
    }
  }

  generateOutputPath(filePath: string): string {
    // Extract the relative path from the watch directory
    const watchDir = appConfig.processing.watchDirectory;
    const relativePath = filePath.startsWith(watchDir)
      ? filePath.slice(watchDir.length).replace(/^\//, '') // Remove leading slash
      : basename(filePath); // Fallback to just filename if not in watch dir

    // Get the directory structure and filename
    const relativeDir = dirname(relativePath);
    const fileName = basename(relativePath);
    const baseName = basename(fileName, extname(fileName));

    // Build output path preserving directory structure
    const outputDir =
      relativeDir && relativeDir !== '.'
        ? join(appConfig.processing.outputDirectory, relativeDir)
        : appConfig.processing.outputDirectory;

    // Return path without timestamp (we want consistent filenames)
    return join(outputDir, baseName);
  }

  async moveCompletedFile(filePath: string): Promise<void> {
    try {
      // Extract the relative path from the watch directory to preserve structure
      const watchDir = appConfig.processing.watchDirectory;
      const relativePath = filePath.startsWith(watchDir)
        ? filePath.slice(watchDir.length).replace(/^\//, '') // Remove leading slash
        : basename(filePath); // Fallback to just filename if not in watch dir

      // Get the directory structure and filename
      const relativeDir = dirname(relativePath);
      const fileName = basename(relativePath);

      // Build completed path preserving directory structure
      const completedDir =
        relativeDir && relativeDir !== '.'
          ? join(appConfig.processing.completedDirectory, relativeDir)
          : appConfig.processing.completedDirectory;

      // Ensure the completed subdirectory exists
      await mkdir(completedDir, { recursive: true });

      const destPath = join(completedDir, fileName);
      await rename(filePath, destPath);
      logger.debug({ from: filePath, to: destPath }, 'Moved completed file');
    } catch (error) {
      logger.warn({ error, filePath }, 'Failed to move completed file');
    }
  }

  async moveFailedFile(filePath: string): Promise<void> {
    try {
      // Extract the relative path from the watch directory to preserve structure
      const watchDir = appConfig.processing.watchDirectory;
      const relativePath = filePath.startsWith(watchDir)
        ? filePath.slice(watchDir.length).replace(/^\//, '') // Remove leading slash
        : basename(filePath); // Fallback to just filename if not in watch dir

      // Get the directory structure and filename
      const relativeDir = dirname(relativePath);
      const fileName = basename(relativePath);

      // Build failed path preserving directory structure
      const failedDir =
        relativeDir && relativeDir !== '.'
          ? join(appConfig.processing.failedDirectory, relativeDir)
          : appConfig.processing.failedDirectory;

      // Ensure the failed subdirectory exists
      await mkdir(failedDir, { recursive: true });

      const destPath = join(failedDir, fileName);
      await rename(filePath, destPath);
      logger.debug({ from: filePath, to: destPath }, 'Moved failed file');
    } catch (error) {
      logger.warn({ error, filePath }, 'Failed to move failed file');
    }
  }
}

export const fileManager = new FileManager();
