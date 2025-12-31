# Story 3.2: Implement Dynamic HealthStatus Computation

## Description
Currently, the `HealthStatus` of a job is often static or not fully utilized. We need to implement logic to dynamically compute the `HealthStatus` based on the job's state, processing time, and history. This will allow the dashboard to show "Stalled", "Recovered", or "Healthy" statuses accurately.

## Acceptance Criteria
- [ ] `computeHealthStatus` function accurately identifies "Stalled" jobs (active > stalledInterval).
- [ ] `computeHealthStatus` function accurately identifies "Recovered" jobs (completed with attempts > 1).
- [ ] `computeHealthStatus` function returns "Healthy" for normal active/completed/waiting jobs.
- [ ] The `GET /jobs/:jobId` endpoint uses this dynamic computation.
- [ ] The `GET /jobs` list endpoint uses this dynamic computation for each job.

## Technical Notes
- We already have a `computeHealthStatus` helper in `jobs.ts` (added in Story 2.6/2.7?). We need to verify it covers all cases and is used consistently.
- We might need to move this logic to a shared service or utility if it's used in multiple places.
- Ensure `stalledInterval` is configurable (it is in `appConfig`).
