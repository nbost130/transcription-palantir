/**
 * 🔮 Transcription Palantir - Error Codes
 *
 * Machine-readable error codes following ERR_<CATEGORY>_<DETAIL> format
 */

export const ErrorCodes = {
  // File Errors
  FILE_INVALID: 'ERR_FILE_INVALID',
  FILE_NOT_FOUND: 'ERR_FILE_NOT_FOUND',
  FILE_NOT_READABLE: 'ERR_FILE_NOT_READABLE',
  FILE_TOO_LARGE: 'ERR_FILE_TOO_LARGE',
  FILE_UNSUPPORTED_FORMAT: 'ERR_FILE_UNSUPPORTED_FORMAT',

  // Whisper Errors
  WHISPER_CRASH: 'ERR_WHISPER_CRASH',
  WHISPER_TIMEOUT: 'ERR_WHISPER_TIMEOUT',
  WHISPER_NOT_FOUND: 'ERR_WHISPER_NOT_FOUND',
  WHISPER_INVALID_OUTPUT: 'ERR_WHISPER_INVALID_OUTPUT',

  // Job Errors
  JOB_STALLED: 'ERR_JOB_STALLED',
  JOB_TIMEOUT: 'ERR_JOB_TIMEOUT',
  JOB_CANCELLED: 'ERR_JOB_CANCELLED',

  // System Errors
  SYSTEM_OUT_OF_MEMORY: 'ERR_SYSTEM_OUT_OF_MEMORY',
  SYSTEM_OUT_OF_DISK: 'ERR_SYSTEM_OUT_OF_DISK',
  SYSTEM_UNKNOWN: 'ERR_SYSTEM_UNKNOWN',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Helper to get human-readable error reason from error code and context
 */
export function getErrorReason(errorCode: ErrorCode, context?: Record<string, any>): string {
  switch (errorCode) {
    case ErrorCodes.FILE_INVALID:
      return 'Audio file is corrupted or in an unsupported format';

    case ErrorCodes.FILE_NOT_FOUND:
      return `Input file not found${context?.filePath ? `: ${context.filePath}` : ''}`;

    case ErrorCodes.FILE_NOT_READABLE:
      return 'Input file is not accessible or readable';

    case ErrorCodes.FILE_TOO_LARGE:
      return `File size exceeds maximum limit${context?.maxSize ? ` of ${context.maxSize}` : ''}`;

    case ErrorCodes.FILE_UNSUPPORTED_FORMAT:
      return `Unsupported audio format${context?.format ? `: ${context.format}` : ''}`;

    case ErrorCodes.WHISPER_CRASH:
      return `Whisper process exited unexpectedly${context?.exitCode !== undefined ? ` with code ${context.exitCode}` : ''}`;

    case ErrorCodes.WHISPER_TIMEOUT:
      return 'Transcription exceeded maximum time limit';

    case ErrorCodes.WHISPER_NOT_FOUND:
      return 'Whisper binary not found or not configured';

    case ErrorCodes.WHISPER_INVALID_OUTPUT:
      return 'Whisper produced invalid or empty output';

    case ErrorCodes.JOB_STALLED:
      return 'Job stalled after 2 attempts';

    case ErrorCodes.JOB_TIMEOUT:
      return `Job exceeded maximum processing time${context?.timeout ? ` of ${context.timeout}ms` : ''}`;

    case ErrorCodes.JOB_CANCELLED:
      return 'Job was cancelled by user or system';

    case ErrorCodes.SYSTEM_OUT_OF_MEMORY:
      return 'System ran out of memory during processing';

    case ErrorCodes.SYSTEM_OUT_OF_DISK:
      return 'System ran out of disk space';
    default:
      return context?.message || 'An unknown error occurred during processing';
  }
}

/**
 * Custom error class that includes error code
 */
export class TranscriptionError extends Error {
  constructor(
    public errorCode: ErrorCode,
    public errorReason: string,
    public context?: Record<string, any>
  ) {
    super(errorReason);
    this.name = 'TranscriptionError';
  }

  static fromCode(errorCode: ErrorCode, context?: Record<string, any>): TranscriptionError {
    const errorReason = getErrorReason(errorCode, context);
    return new TranscriptionError(errorCode, errorReason, context);
  }
}
