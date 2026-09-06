/**
 * 🔮 Transcription Palantir - Configuration Tests
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { appConfig, getRedisUrl, getWhisperCommand } from '../src/config/index.js';

/**
 * `src/config/index.ts` builds `appConfig` once at module-load time, so
 * exercising a different env combination requires resetting the module
 * registry and re-importing it fresh, per env var, then restoring env.
 */
async function loadConfigWithEnv(overrides: Record<string, string | undefined>) {
  const originalEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  vi.resetModules();
  const mod = await import('../src/config/index.js');

  process.env = originalEnv;

  return mod;
}

describe('Configuration', () => {
  beforeAll(() => {
    // Set test environment variables
    process.env.NODE_ENV = 'test';
    process.env.REDIS_HOST = 'localhost';
    process.env.REDIS_PORT = '6379';
  });

  describe('appConfig', () => {
    it('should load configuration successfully', () => {
      expect(appConfig).toBeDefined();
      expect(appConfig.env).toBe('test');
      expect(appConfig.port).toBeTypeOf('number');
      expect(appConfig.serviceName).toBe('transcription-palantir');
    });

    it('should have valid Redis configuration', () => {
      expect(appConfig.redis).toBeDefined();
      expect(appConfig.redis.host).toBe('localhost');
      expect(appConfig.redis.port).toBe(6379);
      expect(appConfig.redis.db).toBeTypeOf('number');
    });

    it('should have valid Whisper configuration', () => {
      expect(appConfig.whisper).toBeDefined();
      expect(appConfig.whisper.model).toBeTypeOf('string');
      expect(appConfig.whisper.binaryPath).toBeTypeOf('string');
      expect(appConfig.whisper.computeType).toBeTypeOf('string');
    });

    it('should have valid processing configuration', () => {
      expect(appConfig.processing).toBeDefined();
      expect(appConfig.processing.maxWorkers).toBeTypeOf('number');
      expect(appConfig.processing.maxWorkers).toBeGreaterThan(0);
      expect(appConfig.processing.supportedFormats).toBeInstanceOf(Array);
      expect(appConfig.processing.supportedFormats.length).toBeGreaterThan(0);
    });
  });

  describe('getRedisUrl', () => {
    it('should generate correct Redis URL without password', () => {
      const url = getRedisUrl();
      expect(url).toMatch(/^redis:\/\/localhost:6379\/\d+$/);
    });

    it('should generate correct Redis URL with password', () => {
      const originalPassword = appConfig.redis.password;
      appConfig.redis.password = 'testpass';

      const url = getRedisUrl();
      expect(url).toMatch(/^redis:\/\/:testpass@localhost:6379\/\d+$/);

      // Restore original password
      appConfig.redis.password = originalPassword;
    });
  });

  describe('getWhisperCommand', () => {
    it('should generate correct Whisper command', () => {
      const inputFile = '/path/to/input.wav';
      const outputDir = '/path/to/output';

      const command = getWhisperCommand(inputFile, outputDir);

      expect(command).toBeInstanceOf(Array);
      expect(command[0]).toBe(appConfig.whisper.binaryPath);
      expect(command).toContain('--model');
      expect(command).toContain(appConfig.whisper.model);
      expect(command).toContain('--output_dir');
      expect(command).toContain(outputDir);
      expect(command).toContain(inputFile);
    });
  });

  describe('validation', () => {
    it('should validate worker configuration', () => {
      expect(appConfig.processing.maxWorkers).toBeGreaterThanOrEqual(appConfig.processing.minWorkers);
    });

    it('should validate file size configuration', () => {
      expect(appConfig.processing.maxFileSize).toBeGreaterThan(appConfig.processing.minFileSize);
    });

    it('should have supported audio formats', () => {
      const formats = appConfig.processing.supportedFormats;
      expect(formats).toContain('mp3');
      expect(formats).toContain('wav');
      expect(formats.every((format) => typeof format === 'string')).toBe(true);
    });
  });

  describe('queue retention (ISC-15)', () => {
    it('reads REMOVE_ON_COMPLETE and REMOVE_ON_FAIL from env', async () => {
      const { appConfig: freshConfig } = await loadConfigWithEnv({
        REMOVE_ON_COMPLETE: '250',
        REMOVE_ON_FAIL: '75',
      });

      expect(freshConfig.queue.removeOnComplete).toBe(250);
      expect(freshConfig.queue.removeOnFail).toBe(75);
    });

    it('defaults REMOVE_ON_COMPLETE to 100 and REMOVE_ON_FAIL to 50 when unset', async () => {
      const { appConfig: freshConfig } = await loadConfigWithEnv({
        REMOVE_ON_COMPLETE: undefined,
        REMOVE_ON_FAIL: undefined,
      });

      expect(freshConfig.queue.removeOnComplete).toBe(100);
      expect(freshConfig.queue.removeOnFail).toBe(50);
    });
  });

  describe('COMPUTE_TYPE (ISC-16)', () => {
    it('defaults to int8 (Mithrandir has no GPU; float16 requires CUDA)', async () => {
      const { appConfig: freshConfig } = await loadConfigWithEnv({
        COMPUTE_TYPE: undefined,
      });

      expect(freshConfig.whisper.computeType).toBe('int8');
    });
  });
});
