# Story 3.3: Remove Delayed Jobs and Fix Prioritized Queue Handling

**Epic:** Epic 3 - Dashboard Data Accuracy  
**Status:** Done  
**Story Points:** 3  
**Priority:** Medium

## Context

During the merge of `origin/main` into `feat/test-suite`, work that removed artificial delays and added proper handling for BullMQ 5's `prioritized` queue was lost. This story restores that functionality.

## Problem Statement

1. **Artificial Delays**: Jobs are being artificially delayed based on priority, which is unnecessary and slows down processing
2. **Prioritized Queue Visibility**: BullMQ 5 stores prioritized jobs in a separate `prioritized` state/list, not in the standard `waiting` list. This causes prioritized jobs to be "invisible" to standard count and fetch methods, leading to:
   - Incorrect job counts in pagination metadata
   - Missing jobs in API responses
   - Inaccurate dashboard statistics

## Acceptance Criteria

### AC1: Remove Artificial Delays
- [x] Remove `calculateDelay` method from `QueueService`
- [x] Explicitly set `delay: 0` in `addJob` method
- [x] Verify jobs are processed immediately regardless of priority

### AC2: Fix Prioritized Job Handling
- [x] Update `getJobCounts()` to include `'prioritized'` in the count query
- [x] Update `getQueueStats()` to include prioritized jobs in statistics
- [x] Update `getJobs()` to fetch prioritized jobs when appropriate
- [x] Update `getAllJobs()` to include prioritized jobs in global pagination

### AC3: Update API Logic
- [x] Update `statusMap` for `JobStatus.PENDING` to include `['waiting', 'prioritized', 'delayed']`
- [x] Update `computeHealthStatus()` to consider `prioritized` jobs as `Healthy`

### AC4: Update Tests
- [x] Update `pagination.test.ts` to reflect removal of delays
- [x] Add tests for prioritized job counting and fetching
- [x] Verify all integration tests pass

## Technical Notes

**Files to Modify:**
- `src/services/queue.ts` - Remove delays, add prioritized handling
- `src/api/controllers/jobs.ts` - Update status mapping and health checks
- `tests/integration/pagination.test.ts` - Update test expectations

**BullMQ 5 Behavior:**
- Prioritized jobs are stored separately from waiting jobs
- Must explicitly query for `'prioritized'` state to include them
- This is different from BullMQ 4 behavior

## Definition of Done
- [x] All acceptance criteria met
- [x] All tests passing
- [x] Code reviewed and approved
- [x] Changes merged to main branch

## References
- Previous implementation in `feat/test-suite` branch (commit before merge)
- BullMQ 5 documentation on prioritized jobs


## References
- Previous implementation in `feat/test-suite` branch (commit before merge)
- BullMQ 5 documentation on prioritized jobs
