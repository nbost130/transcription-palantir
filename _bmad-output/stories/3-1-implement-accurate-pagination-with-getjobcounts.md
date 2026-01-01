# Story 3.1: Implement Accurate Pagination with getJobCounts

## Description
Currently, the dashboard pagination may be inaccurate because it relies on potentially stale or incomplete job counts. We need to implement a robust `getJobCounts` method in the `QueueService` that retrieves accurate counts for all job states directly from Redis/BullMQ. This method should then be used by the `GET /jobs` endpoint to populate pagination metadata.

## Acceptance Criteria
- [ ] `QueueService` has a `getJobCounts` method that returns counts for: `waiting`, `active`, `completed`, `failed`, `delayed`, `paused`.
- [ ] `GET /jobs` endpoint returns accurate `total` count in the pagination metadata based on the requested status filter.
- [ ] `GET /jobs` endpoint returns accurate `totalPages` based on the `total` count and `limit`.
- [ ] Pagination works correctly for all job statuses.
- [ ] Performance is acceptable (counts are fetched efficiently).

## Technical Notes
- BullMQ's `getJobCounts` returns an object with counts for different states.
- We need to ensure we map these correctly to our API response.
- The `GET /jobs` endpoint currently filters by status. The total count returned should match the filter.
