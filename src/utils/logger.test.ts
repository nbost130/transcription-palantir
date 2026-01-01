import { describe, expect, it, vi } from 'vitest';
import {
  createTimer,
  logApiRequest,
  logError,
  logFatalError,
  logFileWatcherEvent,
  logger,
  logJobComplete,
  logJobError,
  logJobStart,
  logQueueEvent,
  logWorkerStart,
  logWorkerStop,
} from './logger';

// Mock pino
const mockInfo = vi.fn(() => {});
const mockError = vi.fn(() => {});
const mockDebug = vi.fn(() => {});
const mockFatal = vi.fn(() => {});
const _mockChild = vi.fn(() => ({
  info: mockInfo,
  error: mockError,
  debug: mockDebug,
  fatal: mockFatal,
}));

// We need to mock the logger instance itself, but since it's exported as a const,
// we'll rely on mocking the methods on the child loggers which are used by the helper functions.
// Note: This test assumes the helper functions use the exported child loggers.

// To properly test the exported functions that use the logger instances,
// we might need to inspect how they are called.
// Since we can't easily replace the `logger` constant in the module,
// we will focus on testing that the helper functions call the logger methods with expected arguments.
// However, since `logger` is already instantiated, we can try to spy on its methods if possible,
// or we can rely on the fact that `pino` is used.

// A better approach for testing without dependency injection is to mock the child loggers.
// But `logger.child` returns a new object.
// Let's try to spy on the methods of the exported loggers.

describe('Logger Utility', () => {
  // We will spy on the methods of the exported loggers
  // Since we can't easily mock the module internals with Bun test yet in the same way as Jest.
  // We will check if the functions run without error and produce output (or mock stdout if needed).
  // For now, let's verify the structure and basic execution.

  it('should export a logger instance', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });

  describe('Helper Functions', () => {
    // Since we can't easily mock the internal logger instances without DI or module mocking,
    // we will verify that these functions execute without throwing errors.
    // In a real integration test, we would capture stdout/stderr.

    it('logJobStart should execute without error', () => {
      expect(() => logJobStart({ jobId: '123', fileName: 'test.wav' })).not.toThrow();
    });

    it('logJobComplete should execute without error', () => {
      expect(() => logJobComplete({ jobId: '123', fileName: 'test.wav', duration: 100 })).not.toThrow();
    });

    it('logJobError should execute without error', () => {
      expect(() => logJobError({ jobId: '123', fileName: 'test.wav', error: new Error('Test error') })).not.toThrow();
    });

    it('logApiRequest should execute without error', () => {
      expect(() => logApiRequest({ requestId: 'req-1', method: 'GET', url: '/test', statusCode: 200 })).not.toThrow();
    });

    it('logWorkerStart should execute without error', () => {
      expect(() => logWorkerStart({ workerId: 'worker-1' })).not.toThrow();
    });

    it('logWorkerStop should execute without error', () => {
      expect(() => logWorkerStop({ workerId: 'worker-1' })).not.toThrow();
    });

    it('logQueueEvent should execute without error', () => {
      expect(() => logQueueEvent('added', { jobId: '123', queueSize: 5 })).not.toThrow();
    });

    it('logFileWatcherEvent should execute without error', () => {
      expect(() => logFileWatcherEvent('add', { fileName: 'test.wav', filePath: '/path/to/test.wav' })).not.toThrow();
    });

    it('logError should execute without error', () => {
      expect(() => logError(new Error('Generic error'))).not.toThrow();
    });

    it('logFatalError should execute without error', () => {
      expect(() => logFatalError(new Error('Fatal error'))).not.toThrow();
    });
  });

  describe('createTimer', () => {
    it('should measure duration', async () => {
      const timer = createTimer('test-timer');
      await new Promise((resolve) => setTimeout(resolve, 10));
      const duration = timer.end();
      expect(duration).toBeGreaterThanOrEqual(10);
    });
  });
});
