# Story 1.4: Implement Boot Sequence Orchestration

**Epic:** Epic 1: Self-Healing Boot & Recovery
**Status:** ready-for-dev

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
