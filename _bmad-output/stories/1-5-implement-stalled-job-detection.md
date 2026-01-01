# Story 1.5: Implement Stalled Job Detection

**Epic:** Epic 1: Self-Healing Boot & Recovery
**Status:** ready-for-dev

As a **system administrator**,
I want the system to detect and recover jobs that have stalled (e.g., worker crash),
So that jobs don't get stuck in 'active' state indefinitely.

**Acceptance Criteria:**

**Given** a job is in `active` state
**When** the worker processing it crashes or loses connectivity
**Then** BullMQ's stalled job mechanism must detect it
**And** it must move the job back to `waiting` (or `failed` if max attempts reached)
**And** it must log a `[SELF-HEAL]` warning

**Given** I am configuring the queue
**When** I set up the worker
**Then** I must configure `lockDuration` to an appropriate value (e.g., 60s)
**And** I must configure `stalledInterval` to check frequently enough

**Given** a job is detected as stalled
**When** the `stalled` event is emitted
**Then** the system must log: `[SELF-HEAL] Job {id} stalled. Re-queuing...`
**And** the `HealthStatus` for that job should be updated (if applicable)
