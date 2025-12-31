# Story 1.6: Implement Reactive State Re-injection

**Epic:** Epic 1: Self-Healing Boot & Recovery
**Status:** ready-for-dev

As a **system administrator**,
I want to manually trigger the reconciliation process via an API endpoint,
So that I can recover the system state without a full restart if Redis data is lost or corrupted.

**Acceptance Criteria:**

**Given** the application is running
**When** I send a `POST` request to `/api/v1/system/reconcile`
**Then** the `ReconciliationService.reconcileOnBoot()` (or a shared `reconcile()` method) must be executed
**And** it must return a report of actions taken (files scanned, jobs created, etc.)
**And** it must be safe to run even if the system is busy (idempotent)

**Given** the reconciliation is running
**When** another request comes in
**Then** it should probably be queued or rejected (to prevent race conditions), or simply allowed if the service is stateless enough.
*Refinement:* Let's make it return 429 or 409 if a reconciliation is already in progress.

**Given** the request completes
**When** I check the logs
**Then** I should see a `[SELF-HEAL]` entry indicating manual triggering.
