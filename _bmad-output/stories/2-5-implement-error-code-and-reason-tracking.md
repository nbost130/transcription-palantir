# Story 2.5: Implement Error Code and Reason Tracking

**Epic:** Epic 2 - Reliable Job Processing
**Status:** ✅ Complete
**Completed:** 2025-12-31

## Story Overview

As an **API client**, I want to see both machine-readable error codes and human-readable error reasons, so that I can programmatically handle errors and display helpful messages to users (FR21).

## Acceptance Criteria

### 1. Basic Error Tracking
✅ **Given** a job fails during processing
✅ **When** the worker catches an error
✅ **Then** it must set both `errorCode` and `errorReason` on the job
✅ **And** the `errorCode` must follow the `ERR_<CATEGORY>_<DETAIL>` format
✅ **And** the `errorReason` must be a human-readable description

### 2. Whisper Crash Handling
✅ **Given** Whisper.cpp crashes during transcription
✅ **When** the error is caught
✅ **Then** the `errorCode` must be `ERR_WHISPER_CRASH`
✅ **And** the `errorReason` must be "Whisper process exited unexpectedly with code {exitCode}"

### 3. Whisper Timeout Handling
✅ **Given** Whisper.cpp times out
✅ **When** the timeout is detected
✅ **Then** the `errorCode` must be `ERR_WHISPER_TIMEOUT`
✅ **And** the `errorReason` must be "Transcription exceeded maximum time limit"

### 4. Invalid File Handling
✅ **Given** the input file is invalid or corrupted
✅ **When** the error is detected
✅ **Then** the `errorCode` must be `ERR_FILE_INVALID`
✅ **And** the `errorReason` must be "Audio file is corrupted or in an unsupported format"

### 5. API Response
✅ **Given** I query a failed job
✅ **When** I GET `/api/v1/jobs/:jobId`
✅ **Then** the response must include both `errorCode` and `errorReason` fields
✅ **And** both fields must be `null` for non-failed jobs

## Implementation Details

### Changes Made

**File: `src/types/error-codes.ts` (NEW FILE)**

Created a comprehensive error code system with:

1. **Error Code Constants** (lines 7-30):
   ```typescript
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
   ```

2. **Human-Readable Error Messages** (lines 37-85):
   ```typescript
   export function getErrorReason(errorCode: ErrorCode, context?: Record<string, any>): string {
     switch (errorCode) {
       case ErrorCodes.FILE_INVALID:
         return 'Audio file is corrupted or in an unsupported format';

       case ErrorCodes.WHISPER_CRASH:
         return `Whisper process exited unexpectedly${context?.exitCode !== undefined ? ` with code ${context.exitCode}` : ''}`;

       case ErrorCodes.WHISPER_TIMEOUT:
         return 'Transcription exceeded maximum time limit';

       // ... (additional error mappings)
     }
   }
   ```

3. **Custom Error Class** (lines 90-104):
   ```typescript
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
   ```

**File: `src/types/index.ts`**

Added exports for the new error code system (line 15):
```typescript
export { ErrorCodes, TranscriptionError, getErrorReason, type ErrorCode } from './error-codes.js';
```

**File: `src/workers/transcription-worker.ts`**

1. **Added imports** (line 9):
   ```typescript
   import { ErrorCodes, TranscriptionError, getErrorReason, type ErrorCode } from '../types/index.js';
   ```

2. **Enhanced file validation** (lines 363-376):
   ```typescript
   private async validateInputFile(filePath: string): Promise<void> {
     try {
       await access(filePath, constants.R_OK);
     } catch (error: any) {
       // Determine specific error code based on error type
       if (error.code === 'ENOENT') {
         throw TranscriptionError.fromCode(ErrorCodes.FILE_NOT_FOUND, { filePath });
       } else if (error.code === 'EACCES') {
         throw TranscriptionError.fromCode(ErrorCodes.FILE_NOT_READABLE, { filePath });
       } else {
         throw TranscriptionError.fromCode(ErrorCodes.FILE_INVALID, { filePath, originalError: error.message });
       }
     }
   }
   ```

3. **Enhanced Whisper error handling** (lines 311-335):
   ```typescript
   } catch (error: any) {
     logger.error({ error, inputPath }, 'Whisper.cpp transcription failed');

     const errorMessage = error.message || String(error);

     if (errorMessage.includes('Python script failed with code')) {
       const match = errorMessage.match(/code (\d+)/);
       const exitCode = match ? parseInt(match[1], 10) : undefined;
       throw TranscriptionError.fromCode(ErrorCodes.WHISPER_CRASH, { exitCode, originalError: errorMessage });
     } else if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
       throw TranscriptionError.fromCode(ErrorCodes.WHISPER_TIMEOUT, { originalError: errorMessage });
     } else if (errorMessage.includes('Failed to spawn') || errorMessage.includes('ENOENT')) {
       throw TranscriptionError.fromCode(ErrorCodes.WHISPER_NOT_FOUND, { originalError: errorMessage });
     } else if (errorMessage.includes('Failed to read transcription output') || errorMessage.includes('empty')) {
       throw TranscriptionError.fromCode(ErrorCodes.WHISPER_INVALID_OUTPUT, { originalError: errorMessage });
     } else if (errorMessage.includes('corrupted') || errorMessage.includes('invalid format')) {
       throw TranscriptionError.fromCode(ErrorCodes.FILE_INVALID, { originalError: errorMessage });
     } else {
       throw TranscriptionError.fromCode(ErrorCodes.SYSTEM_UNKNOWN, { originalError: errorMessage });
     }
   }
   ```

4. **Enhanced job error tracking** (lines 245-283):
   ```typescript
   } catch (error: any) {
     // Determine error code and reason (Story 2.5)
     let errorCode: ErrorCode;
     let errorReason: string;

     if (error instanceof TranscriptionError) {
       errorCode = error.errorCode;
       errorReason = error.errorReason;
     } else {
       errorCode = ErrorCodes.SYSTEM_UNKNOWN;
       errorReason = error.message || String(error);
     }

     logger.error(
       { jobId: job.id, fileName: jobData.fileName, error, errorCode, errorReason },
       '❌ Transcription failed'
     );

     // Update job with error code and reason (Story 2.5 requirement)
     await job.updateData({
       ...jobData,
       errorCode,
       errorReason,
     });

     await this.moveFailedFile(jobData.filePath).catch(() => { });
     throw error;
   }
   ```

### Key Improvements

1. **Type Safety**: TypeScript enforces valid error codes at compile time
2. **Comprehensive Coverage**: Error codes for all major failure scenarios
3. **Context Preservation**: Error context (exit codes, file paths) passed through for detailed messages
4. **Centralized Definitions**: All error codes and messages in one place
5. **API Compatibility**: Error fields already present in TranscriptionJob type from Story 2.3

### Error Code Categories

**File Errors:**
- `ERR_FILE_INVALID` - Corrupted or unsupported format
- `ERR_FILE_NOT_FOUND` - File doesn't exist
- `ERR_FILE_NOT_READABLE` - Permission denied
- `ERR_FILE_TOO_LARGE` - Exceeds size limit
- `ERR_FILE_UNSUPPORTED_FORMAT` - File type not supported

**Whisper Errors:**
- `ERR_WHISPER_CRASH` - Process crashed (includes exit code)
- `ERR_WHISPER_TIMEOUT` - Exceeded time limit
- `ERR_WHISPER_NOT_FOUND` - Binary not found
- `ERR_WHISPER_INVALID_OUTPUT` - Empty or invalid output

**Job Errors:**
- `ERR_JOB_STALLED` - Job stalled after retries
- `ERR_JOB_TIMEOUT` - Job exceeded processing time
- `ERR_JOB_CANCELLED` - User or system cancelled

**System Errors:**
- `ERR_SYSTEM_OUT_OF_MEMORY` - Memory exhausted
- `ERR_SYSTEM_OUT_OF_DISK` - Disk space exhausted
- `ERR_SYSTEM_UNKNOWN` - Fallback for unknown errors

## Testing Results

**Build Status:** ✅ Success
**Test Results:** 29 passing, 2 skipped, 3 failing (pre-existing failures unrelated to changes)

**Pre-existing test failures:**
- 1 config test (NODE_ENV mismatch)
- 1 API integration test (Redis connection cleanup)
- 1 file-watcher test (mock configuration)

**No new test failures introduced by Story 2.5 changes.**

## Files Changed

- `src/types/error-codes.ts` (NEW FILE, 105 lines)
  - Error code constants
  - TranscriptionError class
  - getErrorReason helper function

- `src/types/index.ts` (+1 line)
  - Added error code exports

- `src/workers/transcription-worker.ts` (+45 lines, -15 lines)
  - Added error code imports
  - Enhanced file validation with specific error codes
  - Enhanced Whisper error detection and mapping
  - Enhanced job error tracking with errorCode and errorReason

## API Changes

**Endpoint:** `GET /api/v1/jobs/:jobId`

**Response Enhancement:**
```json
{
  "success": true,
  "data": {
    "id": "123",
    "fileName": "lecture.mp3",
    "status": "failed",
    "errorCode": "ERR_WHISPER_CRASH",
    "errorReason": "Whisper process exited unexpectedly with code 137",
    ...
  }
}
```

**Error Code Examples:**

```json
// File not found
{
  "errorCode": "ERR_FILE_NOT_FOUND",
  "errorReason": "Input file not found: /path/to/missing.mp3"
}

// Whisper timeout
{
  "errorCode": "ERR_WHISPER_TIMEOUT",
  "errorReason": "Transcription exceeded maximum time limit"
}

// Corrupted file
{
  "errorCode": "ERR_FILE_INVALID",
  "errorReason": "Audio file is corrupted or in an unsupported format"
}
```

## Related Requirements

- **FR21:** Machine-readable error codes and human-readable error reasons
- **Story 2.3:** API already includes errorCode and errorReason fields in TranscriptionJob type
- **Architecture Decision #5:** Structured error handling with error codes

## Next Steps

With Story 2.5 complete, the next stories in Epic 2 are:
- **Story 2.6:** Implement System Health Endpoint
- **Story 2.7:** Implement Graceful Shutdown

## Notes

- Error codes follow ERR_<CATEGORY>_<DETAIL> naming convention
- Human-readable messages include context (exit codes, file paths, sizes)
- TranscriptionError class provides type safety and consistency
- All error codes centralized in one file for easy maintenance
- Error detection uses string pattern matching for Whisper subprocess errors
