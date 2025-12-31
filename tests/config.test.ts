/**
 * 🔮 Transcription Palantir - Configuration Tests
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { appConfig, getRedisUrl, getWhisperCommand } from '../src/config/index.js';

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
      expect(appConfig.processing.maxWorkers).toBeGreaterThanOrEqual(
        appConfig.processing.minWorkers
      );
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
});
