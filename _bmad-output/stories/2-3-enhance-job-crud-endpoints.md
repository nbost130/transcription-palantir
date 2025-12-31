# Story 2.3: Enhance Job CRUD Endpoints

**Status:** ✅ DONE
**Branch:** feature/epic-2-reliable-processing
**Completed:** 2025-12-31

## Summary

Enhanced job CRUD endpoints to provide accurate pagination, comprehensive job metadata (errorCode, errorReason, healthStatus), and artifact cleanup on deletion.

## Acceptance Criteria

### ✅ Job Creation (POST /api/v1/jobs)
- [x] System creates job in `Waiting` state (pre-existing)
- [x] Returns job ID and initial status (pre-existing)
- [x] File saved to `WATCH_DIRECTORY` (handled by file-watcher, not API endpoint)

### ✅ Job Detail (GET /api/v1/jobs/:jobId)
- [x] Returns job status, progress, and metadata
- [x] Response includes `status`, `progress`, `errorReason`, `errorCode`, and `healthStatus` fields
- [x] `healthStatus` computed dynamically based on job state (Healthy, Stalled, Recovered, Unknown)

### ✅ Job List (GET /api/v1/jobs)
- [x] Returns paginated results with page, limit, status filter
- [x] Uses `getJobCounts()` for accurate total count (new implementation)
- [x] Response includes `{ data: Job[], pagination: { total, page, limit, totalPages } }`
- [x] Status filter returns only matching jobs

### ✅ Job Deletion (DELETE /api/v1/jobs/:jobId)
- [x] Removes job from Redis
- [x] Deletes associated artifacts (audio file, transcript files)
- [x] Returns success confirmation with artifact deletion summary

## Implementation Details

### Changes Made

**1. Type Definitions (src/types/index.ts)**
- Added `errorCode?: string` field to `TranscriptionJob` interface
- Added `errorReason?: string` field to `TranscriptionJob` interface (separate from `error`)
- Added `healthStatus?: HealthStatus` field to `TranscriptionJob` interface
- Exported `HealthStatus` enum from `health-status.ts`

**2. Queue Service (src/services/queue.ts)**
- Implemented `getJobCounts()` method using BullMQ's native `getJobCounts()`
- More efficient than fetching all jobs and counting manually
- Returns accurate counts for waiting, active, completed, failed, delayed, and total

**3. Job Routes (src/api/routes/jobs.ts)**
- Created `computeHealthStatus(job)` helper function
  - Returns `Stalled` if processing time exceeds `stalledInterval`
  - Returns `Recovered` if job completed after retries (attemptsMade > 0)
  - Returns `Healthy` for normal states (completed, active, waiting)
  - Returns `Unknown` for other states
- Updated GET `/api/v1/jobs/:jobId`:
  - Added `errorCode` from job data
  - Added `errorReason` (from job.data or fallback to failedReason)
  - Added computed `healthStatus`
- Updated GET `/api/v1/jobs`:
  - Changed from `getQueueStats()` to `getJobCounts()` for accurate pagination total
- Enhanced DELETE `/api/v1/jobs/:jobId`:
  - Deletes audio file from `job.data.filePath`
  - Deletes transcript file from `job.data.transcriptPath`
  - Gracefully handles missing files (ENOENT)
  - Returns artifact deletion summary in response

### Files Changed
- `src/types/index.ts` (+6 lines)
- `src/services/queue.ts` (+25 lines)
- `src/api/routes/jobs.ts` (+92 lines, -2 lines)

## Testing

**Build:** ✅ TypeScript compilation successful
**Tests:** ✅ 27 passing, 2 skipped (pre-existing), 1 failing (pre-existing config test)

## Technical Notes

- `computeHealthStatus()` is async because `job.getState()` returns a Promise
- Artifact deletion uses `fs.unlink()` with ENOENT error handling
- `getJobCounts()` more efficient than `getQueueStats()` for pagination (native BullMQ counts vs fetching all jobs)

## Next Steps

Story 2.4: Implement Robust Retry Logic (in backlog)
