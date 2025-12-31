# Story 1.3: Create ReconciliationService

**Epic:** Epic 1: Self-Healing Boot & Recovery
**Status:** ready-for-dev

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
