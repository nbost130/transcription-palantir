---
stepsCompleted: [1, 2, 3, 4]
inputDocuments:
  - /Users/nbost/dev/transcription-palantir/_bmad-output/planning-artifacts/prd.md
  - /Users/nbost/dev/transcription-palantir/_bmad-output/planning-artifacts/architecture.md
  - /Users/nbost/dev/transcription-palantir/_bmad-output/project-context.md
  - /Users/nbost/dev/transcription-palantir/_bmad-output/api-contracts.md
status: 'complete'
completedAt: '2025-12-31'
---

# transcription-palantir - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for transcription-palantir, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

**Job Management:**
- **FR1:** API Clients can create a new transcription job by uploading an audio file.
- **FR2:** API Clients can retrieve the status and progress of a specific job.
- **FR3:** API Clients can list all jobs with pagination and status filtering.
- **FR4 (Robust Retry):** API Clients can explicitly Retry a failed job. This action must reset the job status to `Waiting`, clear any previous `errorReason`, and be idempotent.
- **FR5:** API Clients can delete a job and its associated artifacts.

**Ingestion & Processing:**
- **FR6:** The System must automatically sanitize filenames containing invalid characters upon ingestion.
- **FR7:** The System must prevent duplicate processing of the same file (idempotency).
- **FR8:** The System must process audio files using Whisper.cpp.

**System Health & Self-Healing:**
- **FR9:** The System must automatically detect and reconcile "orphaned" files on startup.
- **FR10:** The System must delete partial/corrupted transcripts before restarting a job.
- **FR11:** API Clients can retrieve detailed system health (including Whisper binary status).
- **FR12:** The System must expose Prometheus-compatible metrics at `/metrics`.

**Integration & Contracts:**
- **FR13:** The System must expose an OpenAPI v3 specification at `/documentation/json`.
- **FR14:** The System must validate all API inputs against a strict schema.
- **FR15:** The System must publish its OpenAPI specification in a format strictly compatible with `openapi-typescript`.
- **FR16 (Schema Parity):** The runtime validation logic (Zod) must exactly match the published OpenAPI document.
- **FR17:** The System must not introduce breaking changes to existing `v1` endpoints without a version increment.

**Data Accuracy & Dashboard Support:**
- **FR18 (State Truthfulness):** The System must ensure the number of jobs in `Processing` state NEVER exceeds the configured `CONCURRENCY_LIMIT`. If the database reports excess processing jobs, the System must automatically detect and mark them as `Stalled` or `Failed`.
- **FR19:** The System must provide accurate `total` counts in pagination metadata.
- **FR20:** The System must expose a `healthStatus` field for each job (e.g., `Healthy`, `Stalled`, `Recovered`).

**Error Handling & Manual Control:**
- **FR21:** The System must record and expose a human-readable `errorReason` and a machine-readable `errorCode` for all failed jobs.
- **FR22 (Reactive State):** If a job status is manually updated to `Waiting` via API, the System must automatically re-inject the job into the processing queue.

### Non-Functional Requirements

**Reliability & Recovery:**
- **NFR1 (MTTR):** The System must recover from a hard crash (process kill) and resume processing pending jobs within 30 seconds of restart.
- **NFR2 (Data Integrity):** The System must achieve 100% Consistency between the Disk State and the Database State after the boot reconciliation process completes.

**Observability:**
- **NFR3 (Log Visibility):** All self-healing events (e.g., "Deleted partial file", "Re-queued job") must be logged at `WARN` level to ensure visibility in logs.
- **NFR4 (Metric Granularity):** Prometheus metrics must be scraped/updated at least every 15 seconds to provide near-real-time visibility.

**Performance:**
- **NFR5 (Concurrency):** The System must support a configurable `CONCURRENCY_LIMIT` (default: 3) to prevent CPU starvation of the host machine.
- **NFR6 (Ingestion Latency):** New files dropped in the `Inbox` must be detected and ingested within 5 seconds.

### Additional Requirements

**From Architecture Document:**

**New Services & Components:**
- Create `ReconciliationService` as standalone service in `src/services/reconciliation.ts` (Decision #1)
- Create `atomicMove()` utility for cross-filesystem atomic file operations in `src/utils/file-operations.ts` (Decision #3)
- Create `HealthStatus` enum in `src/types/health-status.ts` for job health reporting

**BullMQ Configuration:**
- Configure BullMQ stalled job detection with `stalledInterval: 30000`, `maxStalledCount: 2`, `lockDuration: 60000` (Decision #2)

**Implementation Patterns:**
- Error codes must follow `ERR_<CATEGORY>_<DETAIL>` format
- Self-healing logs must use `[SELF-HEAL]` prefix at `WARN` level
- `healthStatus` must be computed dynamically in API responses, not stored
- Pagination must use BullMQ's `getJobCounts()` for accurate totals
- Reactive state updates must call `queue.add()` or `job.retry()` to re-inject jobs

**Operational Requirements:**
- Implement graceful shutdown with `SIGTERM` handling
- Worker must complete current job before exiting
- Chokidar file watcher must use `awaitWriteFinish` for debouncing

**Contract Testing:**
- Generate OpenAPI spec at `/documentation/json`
- Consumer repos (`mithrandir-unified-api`, `mithrandir-admin`) must add `npm run generate:types` script
- Generated types must be committed to consumer repos

**API Versioning:**
- All endpoints are `/api/v1/*`
- Breaking changes require new version prefix (`/api/v2`)
- Non-breaking additions allowed in `/v1`

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR1 | Epic 2 | Create job via upload |
| FR2 | Epic 2 | Get job status |
| FR3 | Epic 2 | List jobs with pagination |
| FR4 | Epic 2 | Robust retry |
| FR5 | Epic 2 | Delete job |
| FR6 | Epic 2 | Filename sanitization |
| FR7 | Epic 2 | Duplicate prevention |
| FR8 | Epic 2 | Whisper.cpp processing |
| FR9 | Epic 1 | Orphaned file reconciliation |
| FR10 | Epic 1 | Partial file cleanup |
| FR11 | Epic 2 | System health (Whisper status) |
| FR12 | Epic 4 | Prometheus metrics |
| FR13 | Epic 4 | OpenAPI spec |
| FR14 | Epic 4 | Input validation |
| FR15 | Epic 4 | openapi-typescript compatibility |
| FR16 | Epic 4 | Zod-OpenAPI parity |
| FR17 | Epic 4 | API versioning |
| FR18 | Epic 1 | State truthfulness |
| FR19 | Epic 3 | Accurate pagination |
| FR20 | Epic 3 | Health status field |
| FR21 | Epic 2 | Error codes/reasons |
| FR22 | Epic 1 | Reactive state |

## Epic List

### Epic 1: Self-Healing Boot & Recovery
**Goal:** The system recovers automatically from crashes, ensuring no lost work and accurate state after restart.

**User Outcome:** After a crash or restart, users see accurate job states with no manual intervention required.

**FRs Covered:** FR9, FR10, FR18, FR22
**NFRs Covered:** NFR1, NFR2, NFR3

**New Components:**
- `ReconciliationService` in `src/services/reconciliation.ts`
- `atomicMove()` utility in `src/utils/file-operations.ts`
- `HealthStatus` enum in `src/types/health-status.ts`
- Boot sequence orchestration in `src/index.ts`

---

### Epic 2: Reliable Job Processing
**Goal:** Jobs are processed reliably with proper error handling, status tracking, and graceful concurrency management.

**User Outcome:** Users can drop files in the Inbox and trust they'll be processed correctly, with clear error messages if something fails.

**FRs Covered:** FR1, FR2, FR3, FR4, FR5, FR6, FR7, FR8, FR11, FR21
**NFRs Covered:** NFR5, NFR6

**Key Capabilities:**
- Job CRUD operations
- Filename sanitization
- Duplicate prevention
- Robust retry logic
- Error codes and reasons
- Graceful shutdown (SIGTERM)

---

### Epic 3: Dashboard Data Accuracy
**Goal:** The dashboard receives accurate, truthful data with proper pagination and health reporting.

**User Outcome:** Users see accurate job counts, real-time health status, and properly paginated results in the dashboard.

**FRs Covered:** FR19, FR20

**Key Capabilities:**
- `getJobCounts()` for accurate totals
- Computed `healthStatus` field
- Proper pagination metadata

---

### Epic 4: API Contracts & Integration
**Goal:** The API contract is stable, versioned, and automatically enforceable by consumers.

**User Outcome:** Consumer repos can regenerate types from the API spec with confidence that the contract is accurate.

**FRs Covered:** FR12, FR13, FR14, FR15, FR16, FR17
**NFRs Covered:** NFR4

**Key Capabilities:**
- OpenAPI spec at `/documentation/json`
- Prometheus metrics at `/metrics`
- Zod-to-OpenAPI schema parity
- `openapi-typescript` compatibility
- API versioning policy

## Epic 1: Self-Healing Boot & Recovery

**Goal:** The system recovers automatically from crashes, ensuring no lost work and accurate state after restart.

### Story 1.1: Create HealthStatus Enum and Types

As a **developer**,
I want to define the `HealthStatus` enum and supporting types,
So that job health can be consistently represented across the system.

**Acceptance Criteria:**

**Given** I am implementing health status tracking
**When** I create the `HealthStatus` enum in `src/types/health-status.ts`
**Then** it must export the following values: `Healthy`, `Stalled`, `Recovered`, `Unknown`
**And** the enum must be a TypeScript string literal union type
**And** the file must export a type guard function `isValidHealthStatus(value: string): value is HealthStatus`

---

### Story 1.2: Create Atomic File Operations Utility

As a **developer**,
I want an `atomicMove()` utility that handles cross-filesystem moves,
So that file operations are atomic even when source and destination are on different filesystems.

**Acceptance Criteria:**

**Given** I need to move files atomically
**When** I call `atomicMove(src, dest)` where both paths are on the same filesystem
**Then** it must use `fs.rename()` for a fast atomic operation
**And** it must succeed without creating temporary files

**Given** I need to move files across different filesystems
**When** I call `atomicMove(src, dest)` and `fs.rename()` fails with `EXDEV` error
**Then** it must copy the file to `${dest}.tmp` on the destination filesystem
**And** it must rename `${dest}.tmp` to `dest` (atomic on same FS)
**And** it must delete the source file
**And** if the process crashes during copy, the `.tmp` file must be safely ignored/cleaned

**Given** the move operation fails
**When** any error occurs (other than `EXDEV`)
**Then** it must throw the error with context about source and destination paths

---

### Story 1.3: Create ReconciliationService

As a **system administrator**,
I want the system to automatically reconcile orphaned files and clean up partial transcripts on startup,
So that the system state is consistent after a crash.

**Acceptance Criteria:**

**Given** the system is starting up after a crash
**When** `ReconciliationService.reconcileOnBoot()` is called
**Then** it must scan the `WATCH_DIRECTORY` (Inbox) for all `.mp3` files
**And** it must query Redis for all jobs in `Waiting` or `Processing` states
**And** it must create jobs for any files in Inbox that are not tracked in Redis (FR9)
**And** it must log each created job with `[SELF-HEAL]` prefix at `WARN` level (NFR3)

**Given** there are partial transcript files from a previous crash
**When** reconciliation detects a job that needs to be restarted
**Then** it must delete any partial `.txt` or `.vtt` files in `OUTPUT_DIRECTORY` for that job (FR10)
**And** it must log the deletion with `[SELF-HEAL]` prefix at `WARN` level (NFR3)
**And** it must reset the job status to `Waiting`

**Given** reconciliation is complete
**When** the service returns its report
**Then** it must return a `ReconciliationReport` object containing:
- `filesScanned: number`
- `jobsCreated: number`
- `partialFilesDeleted: number`
- `jobsReconciled: number`
**And** the report must be logged at `INFO` level

**Given** the reconciliation process completes
**When** comparing disk state to Redis state
**Then** `count(Inbox/*.mp3 tracked by Redis) == count(Redis jobs in Waiting or Processing)` must be true (NFR2)

---

### Story 1.4: Implement Boot Sequence Orchestration

As a **system administrator**,
I want the boot sequence to run ReconciliationService before starting FileWatcher,
So that the system achieves consistent state before processing new files.

**Acceptance Criteria:**

**Given** the application is starting
**When** `src/index.ts` executes the boot sequence
**Then** it must instantiate `ReconciliationService` with `TranscriptionQueue` and `appConfig`
**And** it must call `await reconciliationService.reconcileOnBoot()`
**And** it must wait for reconciliation to complete before proceeding

**Given** reconciliation has completed
**When** the boot sequence continues
**Then** it must instantiate `FileWatcher` with `TranscriptionQueue` and `appConfig`
**And** it must call `fileWatcher.start()`
**And** FileWatcher must NOT start before ReconciliationService completes

**Given** the entire boot sequence completes
**When** measuring time from process start to "ready" state
**Then** the total time must be less than 30 seconds (NFR1 - MTTR)
**And** the system must log "System ready" at `INFO` level

**Given** any error occurs during boot
**When** ReconciliationService or FileWatcher fails
**Then** the application must log the error at `ERROR` level
**And** it must exit with a non-zero exit code
**And** it must NOT start the Fastify server if boot fails

---

### Story 1.5: Implement Stalled Job Detection

As a **system administrator**,
I want the system to automatically detect and mark stalled jobs,
So that the Processing count never exceeds CONCURRENCY_LIMIT (FR18).

**Acceptance Criteria:**

**Given** I am configuring the BullMQ worker
**When** I create the `Worker` instance in `src/workers/transcription-worker.ts`
**Then** it must set `stalledInterval: 30000` (check every 30 seconds)
**And** it must set `maxStalledCount: 2` (mark failed after 2 stalls)
**And** it must set `lockDuration: 60000` (job lock expires after 60 seconds)

**Given** a worker takes a job but dies mid-processing
**When** the lock duration expires (60 seconds)
**Then** BullMQ must emit a `stalled` event for that job
**And** the system must log the stalled job with `[SELF-HEAL]` prefix at `WARN` level (NFR3)
**And** the job must be marked with `healthStatus: 'Stalled'`

**Given** a job has been stalled twice (`maxStalledCount: 2`)
**When** the job stalls a third time
**Then** BullMQ must move the job to `Failed` state
**And** the system must log the failure with `[SELF-HEAL]` prefix at `WARN` level
**And** the job must have `errorCode: 'ERR_JOB_STALLED'` and `errorReason: 'Job stalled after 2 attempts'`

**Given** I query the queue for processing jobs
**When** I call `getJobCounts()`
**Then** the count of jobs in `Processing` state must NEVER exceed `CONCURRENCY_LIMIT` (default: 3)
**And** any excess jobs must be in `Stalled` or `Failed` states

---

### Story 1.6: Implement Reactive State Re-injection

As an **API client**,
I want to manually update a job status to `Waiting` and have it automatically re-injected into the queue,
So that I can manually retry jobs without using the dedicated retry endpoint (FR22).

**Acceptance Criteria:**

**Given** I have a job in `Failed` or `Completed` state
**When** I call `updateJobStatus(jobId, 'waiting')` via the API
**Then** the system must update the job status to `Waiting` in Redis
**And** it must call `queue.add()` or `job.retry()` to re-inject the job into the processing queue
**And** this must NOT be a passive state change—it must trigger active queue insertion

**Given** I attempt to update a job that is already `Processing` or `Waiting`
**When** I call `updateJobStatus(jobId, 'waiting')`
**Then** the system must ignore the request (idempotency)
**And** it must return success without modifying the job
**And** it must log a debug message indicating the job is already in a valid state

**Given** the job is successfully re-injected
**When** the worker picks up the job
**Then** it must process the job normally
**And** the job must transition through `Processing` → `Completed` or `Failed` states as usual

## Epic 2: Reliable Job Processing

**Goal:** Jobs are processed reliably with proper error handling, status tracking, and graceful concurrency management.

### Story 2.1: Implement Filename Sanitization on Ingestion

As an **API client**,
I want filenames with invalid characters to be automatically sanitized,
So that files with special characters can be processed without errors (FR6).

**Acceptance Criteria:**

**Given** I upload a file with invalid characters in the filename (e.g., `My Notes 📝.mp3`)
**When** the FileWatcher detects the file
**Then** it must sanitize the filename by replacing invalid characters with underscores
**And** the sanitized filename must be `My_Notes_.mp3`
**And** the original file must be renamed on disk to the sanitized name
**And** the system must log the sanitization with the original and new filenames at `INFO` level

**Given** the filename contains only valid characters
**When** the FileWatcher detects the file
**Then** it must NOT modify the filename
**And** it must proceed with job creation using the original filename

**Given** the sanitization process completes
**When** the job is created
**Then** the job metadata must include both `originalFilename` and `sanitizedFilename` fields
**And** the API must expose both fields so users can see what was renamed

---

### Story 2.2: Implement Duplicate File Prevention

As an **API client**,
I want the system to prevent duplicate processing of the same file,
So that I don't waste resources re-processing files that are already in the queue (FR7).

**Acceptance Criteria:**

**Given** I drop a file `audio.mp3` into the Inbox
**When** the FileWatcher detects the file
**Then** it must check `FileTrackerService` to see if the file is already tracked
**And** if the file is NOT tracked, it must add the file to the tracker and create a job
**And** if the file IS already tracked, it must skip job creation and log a debug message

**Given** a file is being processed
**When** I drop the same file into the Inbox again (duplicate)
**Then** the system must NOT create a second job
**And** it must log "File already tracked, skipping duplicate" at `DEBUG` level

**Given** a job completes successfully
**When** the file is moved to `COMPLETED_DIRECTORY`
**Then** the file must be removed from `FileTrackerService`
**And** if the same file is dropped again later, it must be treated as a new job

**Given** a job fails
**When** the file is moved to `FAILED_DIRECTORY`
**Then** the file must be removed from `FileTrackerService`
**And** if the same file is dropped again later, it must be treated as a new job

---

### Story 2.3: Enhance Job CRUD Endpoints

As an **API client**,
I want reliable job CRUD operations with accurate pagination,
So that I can manage transcription jobs effectively (FR1, FR2, FR3, FR5).

**Acceptance Criteria:**

**Given** I want to create a new job
**When** I POST to `/api/v1/jobs` with an audio file
**Then** the system must create a new job in the `Waiting` state (FR1)
**And** it must return the job ID and initial status
**And** the file must be saved to `WATCH_DIRECTORY`

**Given** I want to check job status
**When** I GET `/api/v1/jobs/:jobId`
**Then** the system must return the job status, progress, and metadata (FR2)
**And** the response must include `status`, `progress`, `errorReason`, `errorCode`, and `healthStatus` fields

**Given** I want to list all jobs
**When** I GET `/api/v1/jobs?page=1&limit=10&status=completed`
**Then** the system must return paginated results (FR3)
**And** it must use `getJobCounts()` to provide accurate `total` count (FR19)
**And** the response must include `{ data: Job[], total: number, page: number, limit: number }`
**And** if `status` filter is provided, it must only return jobs matching that status

**Given** I want to delete a job
**When** I DELETE `/api/v1/jobs/:jobId`
**Then** the system must remove the job from Redis (FR5)
**And** it must delete associated artifacts (audio file, transcript files)
**And** it must return success confirmation

---

### Story 2.4: Implement Robust Retry Logic

As an **API client**,
I want to retry a failed job with proper state reset,
So that I can recover from transient failures (FR4).

**Acceptance Criteria:**

**Given** I have a job in `Failed` state
**When** I POST to `/api/v1/jobs/:jobId/retry`
**Then** the system must reset the job status to `Waiting`
**And** it must clear any previous `errorReason` and `errorCode` fields
**And** it must re-inject the job into the queue

**Given** the failed job's audio file was moved to `FAILED_DIRECTORY`
**When** I retry the job
**Then** the system must move the file from `FAILED_DIRECTORY` back to `WATCH_DIRECTORY` using `atomicMove()`
**And** the file must be available for processing

**Given** I attempt to retry a job that is already `Processing` or `Waiting`
**When** I POST to `/api/v1/jobs/:jobId/retry`
**Then** the system must ignore the request (idempotency)
**And** it must return success without modifying the job
**And** it must log a debug message indicating the job is already in a valid state

**Given** I attempt to retry a job that is `Completed`
**When** I POST to `/api/v1/jobs/:jobId/retry`
**Then** the system must return an error indicating completed jobs cannot be retried
**And** it must suggest deleting and re-uploading instead

---

### Story 2.5: Implement Error Code and Reason Tracking

As an **API client**,
I want to see both machine-readable error codes and human-readable error reasons,
So that I can programmatically handle errors and display helpful messages to users (FR21).

**Acceptance Criteria:**

**Given** a job fails during processing
**When** the worker catches an error
**Then** it must set both `errorCode` and `errorReason` on the job
**And** the `errorCode` must follow the `ERR_<CATEGORY>_<DETAIL>` format
**And** the `errorReason` must be a human-readable description

**Given** Whisper.cpp crashes during transcription
**When** the error is caught
**Then** the `errorCode` must be `ERR_WHISPER_CRASH`
**And** the `errorReason` must be "Whisper process exited unexpectedly with code {exitCode}"

**Given** Whisper.cpp times out
**When** the timeout is detected
**Then** the `errorCode` must be `ERR_WHISPER_TIMEOUT`
**And** the `errorReason` must be "Transcription exceeded maximum time limit"

**Given** the input file is invalid or corrupted
**When** the error is detected
**Then** the `errorCode` must be `ERR_FILE_INVALID`
**And** the `errorReason` must be "Audio file is corrupted or in an unsupported format"

**Given** I query a failed job
**When** I GET `/api/v1/jobs/:jobId`
**Then** the response must include both `errorCode` and `errorReason` fields
**And** both fields must be `null` for non-failed jobs

---

### Story 2.6: Implement System Health Endpoint

As a **system administrator**,
I want to check the system health including Whisper binary status,
So that I can verify the system is ready to process jobs (FR11).

**Acceptance Criteria:**

**Given** I want to check system health
**When** I GET `/api/v1/health/detailed`
**Then** the system must return a health status object
**And** it must include `whisperBinaryStatus: 'available' | 'missing'`
**And** it must include `whisperVersion: string` (e.g., "1.5.0")
**And** it must include `redisStatus: 'connected' | 'disconnected'`
**And** it must include `queueStats: { waiting: number, processing: number, completed: number, failed: number }`

**Given** the Whisper binary is not found
**When** the health check runs
**Then** `whisperBinaryStatus` must be `'missing'`
**And** `whisperVersion` must be `null`
**And** the overall health status must be `'unhealthy'`

**Given** Redis is disconnected
**When** the health check runs
**Then** `redisStatus` must be `'disconnected'`
**And** the overall health status must be `'unhealthy'`

**Given** all systems are operational
**When** the health check runs
**Then** the overall health status must be `'healthy'`
**And** all subsystem statuses must be positive

---

### Story 2.7: Implement Graceful Shutdown

As a **system administrator**,
I want the worker to gracefully shut down when receiving SIGTERM,
So that in-progress jobs are completed before the process exits.

**Acceptance Criteria:**

**Given** the worker is processing a job
**When** the process receives a `SIGTERM` signal
**Then** the worker must call `worker.close()` to initiate graceful shutdown
**And** it must wait for the current job to complete before exiting
**And** it must log "Graceful shutdown initiated" at `INFO` level

**Given** the worker is idle (no jobs processing)
**When** the process receives a `SIGTERM` signal
**Then** the worker must shut down immediately
**And** it must log "Graceful shutdown complete" at `INFO` level
**And** the process must exit with code 0

**Given** the graceful shutdown is in progress
**When** the current job completes
**Then** the worker must NOT pick up any new jobs
**And** it must close all Redis connections
**And** the process must exit with code 0

**Given** the graceful shutdown takes longer than expected
**When** a timeout is reached (e.g., 60 seconds)
**Then** the worker must force-exit with a warning
**And** it must log "Graceful shutdown timeout, forcing exit" at `WARN` level
**And** the process must exit with code 1

## Epic 3: Dashboard Data Accuracy

**Goal:** The dashboard receives accurate, truthful data with proper pagination and health reporting.

### Story 3.1: Implement Accurate Pagination with getJobCounts()

As a **dashboard user**,
I want to see accurate total counts in paginated job lists,
So that I can trust the data displayed in the UI (FR19).

**Acceptance Criteria:**

**Given** I request a paginated list of jobs
**When** I call `GET /api/v1/jobs?page=1&limit=10`
**Then** the system must use BullMQ's `getJobCounts()` to determine the accurate total
**And** it must NOT infer the total from `jobs.length`
**And** the response must include `{ data: Job[], total: number, page: number, limit: number }`

**Given** there are 100 jobs in the queue
**When** I request page 1 with limit 10
**Then** the `total` field must be exactly 100 (from `getJobCounts()`)
**And** the `data` array must contain 10 jobs
**And** the `page` field must be 1
**And** the `limit` field must be 10

**Given** I filter jobs by status
**When** I call `GET /api/v1/jobs?status=completed`
**Then** the system must use `getJobCounts()` to get the count of completed jobs only
**And** the `total` field must reflect only the filtered count

**Given** the queue statistics are stale
**When** I request job counts
**Then** the system must call `getJobCounts()` fresh for each request
**And** it must NOT cache the counts for more than a few seconds

---

### Story 3.2: Implement Dynamic HealthStatus Computation

As a **dashboard user**,
I want to see the real-time health status of each job,
So that I can identify stalled or recovered jobs (FR20).

**Acceptance Criteria:**

**Given** I request a job's details
**When** I call `GET /api/v1/jobs/:jobId`
**Then** the response must include a `healthStatus` field
**And** the `healthStatus` must be computed dynamically, NOT stored in job data
**And** the value must be one of: `Healthy`, `Stalled`, `Recovered`, `Unknown`

**Given** a job is in `Processing` state and has not stalled
**When** I query the job
**Then** `healthStatus` must be `Healthy`

**Given** a job has been marked as stalled by BullMQ
**When** I query the job
**Then** `healthStatus` must be `Stalled`

**Given** a job was previously stalled but is now processing again
**When** I query the job
**Then** `healthStatus` must be `Recovered`

**Given** a job's health status cannot be determined
**When** I query the job
**Then** `healthStatus` must be `Unknown`

**Given** I list multiple jobs
**When** I call `GET /api/v1/jobs`
**Then** each job in the response must include a computed `healthStatus` field
**And** the computation must be performed for each job individually

---

## Epic 4: API Contracts & Integration

**Goal:** The API contract is stable, versioned, and automatically enforceable by consumers.

### Story 4.1: Expose Prometheus Metrics Endpoint

As a **system administrator**,
I want to scrape Prometheus metrics from the `/metrics` endpoint,
So that I can monitor system performance in real-time (FR12, NFR4).

**Acceptance Criteria:**

**Given** I want to monitor the system
**When** I GET `/metrics`
**Then** the system must return Prometheus-compatible metrics in text format
**And** it must include metrics for:
- `transcription_jobs_total{status="waiting|processing|completed|failed"}`
- `transcription_queue_size`
- `transcription_processing_duration_seconds`
- `transcription_errors_total{error_code="..."}`

**Given** the metrics are being scraped
**When** I check the update frequency
**Then** the metrics must be updated at least every 15 seconds (NFR4)
**And** the metrics must reflect near-real-time queue statistics

**Given** a job completes
**When** I scrape `/metrics` within 15 seconds
**Then** the `transcription_jobs_total{status="completed"}` counter must be incremented

---

### Story 4.2: Generate OpenAPI Specification

As a **consumer developer**,
I want to access the OpenAPI v3 specification at `/documentation/json`,
So that I can generate TypeScript types for my client application (FR13, FR15).

**Acceptance Criteria:**

**Given** I want to generate types for my consumer app
**When** I GET `/documentation/json`
**Then** the system must return a valid OpenAPI v3 specification in JSON format
**And** the spec must be generated from Fastify schemas using `@fastify/swagger`

**Given** I use `openapi-typescript` to generate types
**When** I run `npx openapi-typescript http://palantir.tailnet:3001/documentation/json -o types/palantir.d.ts`
**Then** the command must succeed without errors (FR15)
**And** the generated types must be valid TypeScript
**And** the types must accurately represent all API endpoints and schemas

**Given** the API has multiple endpoints
**When** I view the OpenAPI spec
**Then** it must include all `/api/v1/*` endpoints
**And** each endpoint must have request/response schemas defined
**And** all schemas must use proper TypeScript-compatible types

---

### Story 4.3: Ensure Zod-OpenAPI Schema Parity

As a **developer**,
I want runtime validation (Zod) to exactly match the published OpenAPI spec,
So that there are no discrepancies between validation and documentation (FR16).

**Acceptance Criteria:**

**Given** I define a Zod schema for an API endpoint
**When** the OpenAPI spec is generated
**Then** the OpenAPI schema must exactly match the Zod schema
**And** there must be no drift between runtime validation and documentation

**Given** I add a new field to a Zod schema
**When** the OpenAPI spec is regenerated
**Then** the new field must appear in the OpenAPI spec
**And** the field type must match the Zod type

**Given** I make a field required in Zod
**When** the OpenAPI spec is regenerated
**Then** the field must be marked as required in the OpenAPI spec

**Given** there is a mismatch between Zod and OpenAPI
**When** I run tests
**Then** the tests must fail with a clear error indicating the mismatch
**And** the error must show which fields differ

---

### Story 4.4: Implement API Input Validation

As an **API client**,
I want all API inputs to be validated against a strict schema,
So that I receive clear error messages for invalid requests (FR14).

**Acceptance Criteria:**

**Given** I send an invalid request to an API endpoint
**When** the request is processed
**Then** the system must validate the input against the Zod schema
**And** it must return a 400 Bad Request error
**And** the error response must include specific validation errors

**Given** I send a request with a missing required field
**When** the validation runs
**Then** the error must indicate which field is missing
**And** the error message must be clear and actionable

**Given** I send a request with an invalid field type
**When** the validation runs
**Then** the error must indicate the expected type and the received type
**And** the error message must help me correct the request

**Given** I send a valid request
**When** the validation runs
**Then** the request must pass validation
**And** it must proceed to the route handler

---

### Story 4.5: Document API Versioning Policy

As a **consumer developer**,
I want to understand the API versioning policy,
So that I can safely upgrade my client without breaking changes (FR17).

**Acceptance Criteria:**

**Given** I am integrating with the API
**When** I read the project README
**Then** it must document the API versioning policy
**And** it must state that all endpoints use `/api/v1/*` prefix
**And** it must explain that breaking changes require a new version prefix (`/api/v2`)
**And** it must clarify that non-breaking additions are allowed in `/v1`

**Given** a breaking change is needed
**When** the change is implemented
**Then** it must be introduced under a new `/api/v2/*` prefix
**And** the `/api/v1/*` endpoints must remain unchanged
**And** both versions must be supported simultaneously during a transition period

**Given** a non-breaking change is made (e.g., adding an optional field)
**When** the change is deployed
**Then** it must be added to the existing `/api/v1/*` endpoints
**And** existing clients must continue to work without modification

---

### Story 4.6: Setup Consumer Repo Type Generation

As a **consumer developer**,
I want to easily regenerate TypeScript types from the API spec,
So that my client code stays in sync with the API contract.

**Acceptance Criteria:**

**Given** I am working on `mithrandir-unified-api`
**When** I run `npm run generate:types`
**Then** it must execute `npx openapi-typescript http://palantir.tailnet:3001/documentation/json -o src/types/palantir.d.ts`
**And** it must generate fresh TypeScript types
**And** the generated file must be committed to the repo

**Given** I am working on `mithrandir-admin`
**When** I run `npm run generate:types`
**Then** it must execute `npx openapi-typescript http://palantir.tailnet:3001/documentation/json -o src/types/palantir.d.ts`
**And** it must generate fresh TypeScript types
**And** the generated file must be committed to the repo

**Given** the API contract changes
**When** I regenerate types in a consumer repo
**Then** TypeScript compilation errors must indicate any breaking changes
**And** the errors must guide me to update my client code

**Given** I want to understand the contract testing workflow
**When** I read the documentation
**Then** it must explain how to regenerate types
**And** it must explain how TypeScript compilation enforces the contract
**And** it must provide examples of the workflow


