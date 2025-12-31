# Story 2.4: Implement Robust Retry Logic

**Epic:** Epic 2 - Reliable Job Processing
**Status:** ✅ Complete
**Completed:** 2025-12-31

## Story Overview

As an **API client**, I want to retry a failed job with proper state reset, so that I can recover from transient failures (FR4).

## Acceptance Criteria

### 1. Basic Retry Functionality
✅ **Given** I have a job in `Failed` state
✅ **When** I POST to `/api/v1/jobs/:jobId/retry`
✅ **Then** the system must reset the job status to `Waiting`
✅ **And** it must clear any previous `errorReason` and `errorCode` fields
✅ **And** it must re-inject the job into the queue

### 2. File Recovery
✅ **Given** the failed job's audio file was moved to `FAILED_DIRECTORY`
✅ **When** I retry the job
✅ **Then** the system must move the file from `FAILED_DIRECTORY` back to `WATCH_DIRECTORY` using `atomicMove()`
✅ **And** the file must be available for processing

### 3. Idempotency for Active Jobs
✅ **Given** I attempt to retry a job that is already `Processing` or `Waiting`
✅ **When** I POST to `/api/v1/jobs/:jobId/retry`
✅ **Then** the system must ignore the request (idempotency)
✅ **And** it must return success without modifying the job
✅ **And** it must log a debug message indicating the job is already in a valid state

### 4. Completed Job Protection
✅ **Given** I attempt to retry a job that is `Completed`
✅ **When** I POST to `/api/v1/jobs/:jobId/retry`
✅ **Then** the system must return an error indicating completed jobs cannot be retried
✅ **And** it must suggest deleting and re-uploading instead

## Implementation Details

### Changes Made

**File: `src/api/routes/jobs.ts`**

1. **Added import for atomicMove utility:**
   ```typescript
   import { atomicMove } from '../../utils/file-operations.js';
   ```

2. **Enhanced state validation logic (lines 790-826):**
   - Added idempotency check for `waiting` and `active` states
   - Added protection against retrying `completed` jobs with helpful error message
   - Maintained existing validation for other invalid states

3. **Replaced fs.rename() with atomicMove() (line 841):**
   - Changed from `fs.rename(failedPath, job.data.filePath)` to `atomicMove(failedPath, job.data.filePath)`
   - Ensures atomic file operations even across different filesystems
   - Prevents partial file moves that could leave system in inconsistent state

4. **Added error field clearing (lines 855-860):**
   ```typescript
   // Clear error fields before retrying (Story 2.4 requirement)
   await job.updateData({
     ...job.data,
     errorCode: undefined,
     errorReason: undefined,
   });
   ```
   - Clears `errorCode` and `errorReason` before calling `retryJob()`
   - Ensures clean slate for retry attempt

5. **Added debug logging for idempotency (line 795):**
   ```typescript
   fastify.log.debug({ jobId, state }, 'Job is already in a valid state, skipping retry (idempotent)');
   ```

### Key Improvements

1. **Idempotency:** Multiple retry requests for the same job won't cause issues
2. **Atomic File Operations:** Cross-filesystem moves are now safe
3. **Clean State Reset:** Error fields are properly cleared before retry
4. **Better User Experience:** Clear error messages for invalid retry attempts
5. **Debugging Support:** Debug logs help track idempotent requests

## Testing Results

**Build Status:** ✅ Success
**Test Results:** 29 passing, 2 skipped, 3 failing (pre-existing failures unrelated to changes)

**Pre-existing test failures:**
- 1 config test (NODE_ENV mismatch)
- 1 API integration test (Redis connection cleanup)
- 1 file-watcher test (mock configuration)

**No new test failures introduced by Story 2.4 changes.**

## Files Changed

- `src/api/routes/jobs.ts` (+46 lines, -25 lines)
  - Added atomicMove import
  - Enhanced retry endpoint with idempotency and validation
  - Replaced fs.rename with atomicMove
  - Added error field clearing
  - Added debug logging

## API Changes

**Endpoint:** `POST /api/v1/jobs/:jobId/retry`

**New Behavior:**
- Returns 200 with success message if job is already `waiting` or `active` (idempotent)
- Returns 400 with helpful message if job is `completed`
- Clears `errorCode` and `errorReason` fields before retry
- Uses atomic file operations for cross-filesystem safety

**Response Examples:**

```json
// Successful retry of failed job
{
  "success": true,
  "data": {
    "jobId": "123",
    "message": "Job retried successfully"
  },
  "timestamp": "2025-12-31T19:30:00.000Z",
  "requestId": "abc-123"
}

// Idempotent retry of already-processing job
{
  "success": true,
  "data": {
    "jobId": "123",
    "message": "Job is already active, no retry needed",
    "state": "active"
  },
  "timestamp": "2025-12-31T19:30:00.000Z",
  "requestId": "abc-123"
}

// Attempted retry of completed job
{
  "success": false,
  "error": "Cannot retry a completed job. Consider deleting and re-uploading the file instead.",
  "timestamp": "2025-12-31T19:30:00.000Z",
  "requestId": "abc-123"
}
```

## Related Requirements

- **FR4:** Robust retry with state reset and idempotency
- **Story 1.2:** Uses `atomicMove()` utility for cross-filesystem safety
- **Architecture Decision #3:** Atomic file operations pattern

## Next Steps

With Story 2.4 complete, the next stories in Epic 2 are:
- **Story 2.5:** Implement Error Code and Reason Tracking
- **Story 2.6:** Implement System Health Endpoint
- **Story 2.7:** Implement Graceful Shutdown

## Notes

- The retry endpoint now follows best practices for idempotency
- Cross-filesystem file moves are handled safely with atomicMove
- Error state is properly reset to give jobs a clean retry
- User-friendly error messages guide API consumers
