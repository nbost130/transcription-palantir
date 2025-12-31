# Story 2.7: Implement Graceful Shutdown

**Epic:** Epic 2 - Reliable Job Processing
**Status:** ✅ Complete
**Completed:** 2025-12-31

## Story Overview

As a **system administrator**, I want the worker to gracefully shut down when receiving SIGTERM, so that in-progress jobs are completed before the process exits.

## Acceptance Criteria

### 1. Worker Processing a Job
✅ **Given** the worker is processing a job
✅ **When** the process receives a `SIGTERM` signal
✅ **Then** the worker must call `worker.close()` to initiate graceful shutdown
✅ **And** it must wait for the current job to complete before exiting
✅ **And** it must log "Graceful shutdown initiated" at `INFO` level

### 2. Worker Idle (No Jobs)
✅ **Given** the worker is idle (no jobs processing)
✅ **When** the process receives a `SIGTERM` signal
✅ **Then** the worker must shut down immediately
✅ **And** it must log "Graceful shutdown complete" at `INFO` level
✅ **And** the process must exit with code 0

### 3. Shutdown in Progress
✅ **Given** the graceful shutdown is in progress
✅ **When** the current job completes
✅ **Then** the worker must NOT pick up any new jobs
✅ **And** it must close all Redis connections
✅ **And** the process must exit with code 0

### 4. Shutdown Timeout
✅ **Given** the graceful shutdown takes longer than expected
✅ **When** a timeout is reached (60 seconds)
✅ **Then** the worker must force-exit with a warning
✅ **And** it must log "Graceful shutdown timeout, forcing exit" at `WARN` level
✅ **And** the process must exit with code 1

## Implementation Details

### Changes Made

**File: `src/workers/transcription-worker.ts`**

Enhanced the `stop()` method with timeout handling and proper logging:

**Before (lines 89-112):**
```typescript
async stop(): Promise<void> {
  if (!this.isRunning) {
    return;
  }

  try {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }

    await redisConnection.quit();

    this.isRunning = false;

    logger.info(
      {
        processedJobs: this.processedJobs,
        failedJobs: this.failedJobs,
      },
      '✅ Transcription worker stopped gracefully'
    );
  } catch (error) {
    logger.error({ error }, 'Error stopping transcription worker');
  }
}
```

**After (lines 89-145):**
```typescript
async stop(): Promise<void> {
  if (!this.isRunning) {
    return;
  }

  // Log graceful shutdown initiation (Story 2.7)
  logger.info('Graceful shutdown initiated');

  try {
    if (this.worker) {
      // Create timeout promise (Story 2.7: force-exit after 60 seconds)
      const SHUTDOWN_TIMEOUT_MS = 60000;
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Graceful shutdown timeout'));
        }, SHUTDOWN_TIMEOUT_MS);
      });

      // Race between graceful shutdown and timeout
      try {
        await Promise.race([
          this.worker.close(), // Waits for current job to complete
          timeoutPromise,
        ]);
      } catch (error: any) {
        if (error.message === 'Graceful shutdown timeout') {
          logger.warn('Graceful shutdown timeout, forcing exit');
          // Force close without waiting
          await this.worker.close(true);
          this.worker = null;
          await redisConnection.quit();
          this.isRunning = false;
          process.exit(1);
        }
        throw error;
      }

      this.worker = null;
    }

    await redisConnection.quit();

    this.isRunning = false;

    // Log graceful shutdown completion (Story 2.7)
    logger.info(
      {
        processedJobs: this.processedJobs,
        failedJobs: this.failedJobs,
      },
      'Graceful shutdown complete'
    );
  } catch (error) {
    logger.error({ error }, 'Error stopping transcription worker');
    throw error;
  }
}
```

### Key Improvements

1. **Graceful Shutdown Initiation Logging**: Logs "Graceful shutdown initiated" at the start
2. **Timeout Handling**: Uses `Promise.race()` to implement 60-second timeout
3. **Force-Exit on Timeout**: Calls `worker.close(true)` to force close if timeout is reached
4. **Timeout Warning Logging**: Logs "Graceful shutdown timeout, forcing exit" at WARN level
5. **Exit Code Management**: Exits with code 1 on timeout, code 0 on success
6. **Graceful Shutdown Completion Logging**: Logs "Graceful shutdown complete" on successful shutdown

### Shutdown Flow

**Normal Shutdown (Job Completes in Time):**
```
1. SIGTERM received
2. index.ts calls transcriptionWorker.stop()
3. Worker logs "Graceful shutdown initiated"
4. worker.close() called (waits for current job to complete)
5. Job completes within 60 seconds
6. Redis connection closed
7. Worker logs "Graceful shutdown complete"
8. Process exits with code 0
```

**Timeout Shutdown (Job Takes Too Long):**
```
1. SIGTERM received
2. index.ts calls transcriptionWorker.stop()
3. Worker logs "Graceful shutdown initiated"
4. worker.close() called (waits for current job)
5. 60 seconds pass before job completes
6. Timeout promise rejects
7. Worker logs "Graceful shutdown timeout, forcing exit" (WARN)
8. worker.close(true) called to force close
9. Redis connection closed
10. Process exits with code 1
```

**Idle Shutdown (No Jobs Processing):**
```
1. SIGTERM received
2. index.ts calls transcriptionWorker.stop()
3. Worker logs "Graceful shutdown initiated"
4. worker.close() returns immediately (no jobs to wait for)
5. Redis connection closed
6. Worker logs "Graceful shutdown complete"
7. Process exits with code 0
```

### BullMQ Worker Behavior

**`worker.close()` (graceful):**
- Stops accepting new jobs immediately
- Waits for currently processing jobs to complete
- Closes Redis connections when done

**`worker.close(true)` (force):**
- Stops accepting new jobs immediately
- Does NOT wait for currently processing jobs
- Closes Redis connections immediately

### Timeout Implementation

```typescript
const SHUTDOWN_TIMEOUT_MS = 60000; // 60 seconds

const timeoutPromise = new Promise((_, reject) => {
  setTimeout(() => {
    reject(new Error('Graceful shutdown timeout'));
  }, SHUTDOWN_TIMEOUT_MS);
});

await Promise.race([
  this.worker.close(),  // Graceful close
  timeoutPromise,       // Timeout after 60s
]);
```

## Testing Results

**Build Status:** ✅ Success
**Test Results:** 29 passing, 2 skipped, 3 failing (pre-existing failures unrelated to changes)

**Pre-existing test failures:**
- 1 config test (NODE_ENV mismatch)
- 1 API integration test (Redis connection cleanup)
- 1 file-watcher test (mock configuration)

**No new test failures introduced by Story 2.7 changes.**

## Files Changed

- `src/workers/transcription-worker.ts` (+35 lines, -9 lines)
  - Enhanced stop() method with timeout handling
  - Added graceful shutdown initiation logging
  - Added graceful shutdown completion logging
  - Added timeout warning logging
  - Added Promise.race() for timeout enforcement
  - Added force-exit logic on timeout

## Behavioral Changes

**Before Story 2.7:**
- Worker waited indefinitely for jobs to complete during shutdown
- No timeout handling (could hang forever)
- Logged generic "worker stopped gracefully" message

**After Story 2.7:**
- Worker logs "Graceful shutdown initiated" when shutdown starts
- Worker waits up to 60 seconds for jobs to complete
- If timeout is reached:
  - Logs "Graceful shutdown timeout, forcing exit" (WARN)
  - Force-closes worker without waiting
  - Exits with code 1
- If shutdown completes normally:
  - Logs "Graceful shutdown complete" with job statistics
  - Exits with code 0

## Signal Handling (Already Implemented)

The signal handlers in `src/index.ts` (lines 162-173) already handle SIGTERM and SIGINT:

```typescript
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, initiating graceful shutdown...');
  await this.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, initiating graceful shutdown...');
  await this.stop();
  process.exit(0);
});
```

**Note:** The process.exit(0) in the signal handlers will only execute if the worker shutdown completes normally. If the worker timeout is triggered, the worker itself calls process.exit(1) directly.

## Production Impact

**Systemd Integration:**
- When systemd sends SIGTERM during restart/stop, the worker will:
  - Complete current transcription job (if any)
  - Exit gracefully with code 0 (normal case)
  - Force-exit with code 1 if job takes > 60 seconds

**Docker Integration:**
- When Docker sends SIGTERM during container stop:
  - Worker completes current job before container stops
  - Prevents partial transcriptions
  - Ensures clean shutdown

## Related Requirements

- **Architecture Decision #7:** Graceful shutdown with timeout
- **Story 1.6:** Reactive state re-injection (handles interrupted jobs on restart)
- **Production Guidelines:** Systemd service management

## Next Steps

With Story 2.7 complete, Epic 2 (Reliable Job Processing) is now complete! All stories in the epic have been implemented:

- ✅ Story 2.1: Filename Sanitization on Ingestion
- ✅ Story 2.2: Duplicate File Prevention
- ✅ Story 2.3: Enhanced Job CRUD Endpoints
- ✅ Story 2.4: Robust Retry Logic
- ✅ Story 2.5: Error Code and Reason Tracking
- ✅ Story 2.6: System Health Endpoint
- ✅ Story 2.7: Graceful Shutdown

**Next Steps:**
1. Merge feature branch to main
2. Optional: Run retrospective (epic-2-retrospective)
3. Continue with Epic 3: Dashboard Data Accuracy

## Notes

- Timeout of 60 seconds is configurable via SHUTDOWN_TIMEOUT_MS constant
- BullMQ worker.close() already handles preventing new job pickup during shutdown
- Redis connection cleanup is automatic with redisConnection.quit()
- Exit code 0 = successful graceful shutdown, exit code 1 = timeout/forced shutdown
