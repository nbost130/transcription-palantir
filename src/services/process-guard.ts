/**
 * 🔮 Transcription Palantir - Process Guard Service
 *
 * Prevents multiple instances of the service from running simultaneously
 * by detecting existing processes and port conflicts before startup.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { appConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

// =============================================================================
// PROCESS GUARD SERVICE
// =============================================================================

export class ProcessGuardService {
  /**
   * Check if another instance is already running
   * Returns true if safe to start, false if another instance detected
   */
  async checkForExistingInstance(): Promise<boolean> {
    try {
      // Check if port is already in use
      const portInUse = await this.isPortInUse(appConfig.port);

      if (portInUse) {
        const processInfo = await this.getProcessOnPort(appConfig.port);
        logger.error({ port: appConfig.port, processInfo }, '🚨 Port already in use by another process');
        return false;
      }

      // Check for other bun processes running this service
      const existingProcesses = await this.findExistingProcesses();

      if (existingProcesses.length > 0) {
        logger.error({ processes: existingProcesses }, '🚨 Found existing service processes');
        return false;
      }

      logger.info('✅ No existing instances detected - safe to start');
      return true;
    } catch (error) {
      logger.error({ error }, 'Error checking for existing instances');
      // Fail safe - allow startup if we can't check
      return true;
    }
  }

  /**
   * Kill any rogue processes that might be blocking startup
   * USE WITH CAUTION - only call this if you're sure they should be killed
   */
  async killRogueProcesses(): Promise<number> {
    try {
      const processes = await this.findExistingProcesses();
      let killedCount = 0;

      for (const proc of processes) {
        try {
          logger.warn({ pid: proc.pid, cmd: proc.cmd }, 'Killing rogue process');
          await execAsync(`kill -9 ${proc.pid}`);
          killedCount++;
        } catch (error) {
          logger.error({ error, pid: proc.pid }, 'Failed to kill process');
        }
      }

      return killedCount;
    } catch (error) {
      logger.error({ error }, 'Error killing rogue processes');
      return 0;
    }
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  private async isPortInUse(port: number): Promise<boolean> {
    try {
      // Use lsof to check if port is in use
      const { stdout } = await execAsync(`lsof -ti :${port}`);
      return stdout.trim().length > 0;
    } catch (error: any) {
      // lsof returns exit code 1 if no process found
      if (error.code === 1) {
        return false;
      }
      throw error;
    }
  }

  private async getProcessOnPort(port: number): Promise<ProcessInfo | null> {
    try {
      const { stdout } = await execAsync(`lsof -ti :${port}`);
      const pid = stdout.trim();

      if (!pid) {
        return null;
      }

      const { stdout: psOutput } = await execAsync(`ps -p ${pid} -o pid,ppid,command`);
      const lines = psOutput.trim().split('\n');

      if (lines.length < 2) {
        return null;
      }

      const line = lines[1];
      if (!line) {
        return null;
      }

      const parts = line.trim().split(/\s+/);
      const pidStr = parts[0];
      const ppidStr = parts[1];
      const cmdParts = parts.slice(2);

      return {
        pid: parseInt(pidStr || '0'),
        ppid: parseInt(ppidStr || '0'),
        cmd: cmdParts.join(' '),
      };
    } catch (error) {
      logger.error({ error, port }, 'Error getting process on port');
      return null;
    }
  }

  private async findExistingProcesses(): Promise<ProcessInfo[]> {
    try {
      // Find bun processes running our service (excluding current process)
      const currentPid = process.pid;
      const { stdout } = await execAsync(`ps aux | grep "bun.*transcription-palantir.*dist/index.js" | grep -v grep`);

      if (!stdout.trim()) {
        return [];
      }

      const processes: ProcessInfo[] = [];
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 11) continue;

        const pidStr = parts[1];
        if (!pidStr) continue;

        const pid = parseInt(pidStr);

        // Skip current process
        if (pid === currentPid) {
          continue;
        }

        const cmd = parts.slice(10).join(' ');

        // Get PPID
        try {
          const { stdout: ppidOutput } = await execAsync(`ps -p ${pid} -o ppid=`);
          const ppidStr = ppidOutput.trim();
          const ppid = parseInt(ppidStr || '0');

          processes.push({ pid, ppid, cmd });
        } catch {}
      }

      return processes;
    } catch (error: any) {
      // grep returns exit code 1 if no matches found
      if (error.code === 1) {
        return [];
      }
      logger.error({ error }, 'Error finding existing processes');
      return [];
    }
  }
}

// =============================================================================
// TYPES
// =============================================================================

interface ProcessInfo {
  pid: number;
  ppid: number;
  cmd: string;
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const processGuard = new ProcessGuardService();
