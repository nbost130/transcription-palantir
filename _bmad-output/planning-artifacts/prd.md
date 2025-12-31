---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
inputDocuments:
  - /Users/nbost/dev/transcription-palantir/_bmad-output/analysis/brainstorming-session-2025-12-30.md
  - /Users/nbost/dev/transcription-palantir/_bmad-output/project-context.md
  - /Users/nbost/dev/transcription-palantir/_bmad-output/api-contracts.md
  - /Users/nbost/dev/transcription-palantir/_bmad-output/data-models.md
  - /Users/nbost/dev/transcription-palantir/_bmad-output/source-tree-analysis.md
  - /Users/nbost/dev/transcription-palantir/_bmad-output/development-guide.md
  - /Users/nbost/dev/transcription-palantir/_bmad-output/index.md
workflowType: 'prd'
lastStep: 0
documentCounts:
  briefCount: 0
  researchCount: 0
  brainstormingCount: 1
  projectDocsCount: 6
---

# Product Requirements Document - transcription-palantir

**Author:** Nathan
**Date:** 2025-12-30

## Executive Summary

**Transcription Palantir: Stability & Reliability Overhaul**

This initiative transforms the existing Transcription Palantir service from a fragile, "happy-path" prototype into a robust, self-healing production system. The primary focus is eliminating "whack-a-mole" instability by implementing **Full-Stack Resilience**—shifting the source of truth to persistent disk storage, enforcing strict API contracts, and visualizing recovery states to the user.

### What Makes This Special

**The "Self-Healing" Architecture**
Unlike typical job queues that blindly trust their cache, this upgraded system treats Redis as a disposable optimization. By implementing **Boot Reconciliation** and **Disk-Based Disaster Recovery**, the system can reconstruct its entire state from the file system. It mitigates "Limbo States" through **Atomic File Operations** and ensures trust via **Startup Integrity Checks**.

**Integration Integrity**
To prevent distributed system failures, we introduce a **Single Source of Truth** for API contracts. By generating strict TypeScript clients from OpenAPI specs and implementing **Contract Tests**, we ensure that `transcription-palantir`, `mithrandir-admin`, and `mithrandir-unified-api` remain in perfect sync, catching integration bugs at compile time rather than runtime.

## Project Classification

**Technical Type:** api_backend
**Domain:** General Software / Reliability Engineering
**Complexity:** Medium
**Project Context:** Brownfield - extending existing system

**Key Focus Areas:**
- **Robust Ingestion:** Basic input sanitization (path traversal protection), structure preservation, and atomic moves.
- **State Reconciliation:** Killing zombie jobs, syncing with disk, and handling locked files.
- **Integration Integrity:** Shared types, contract testing, and state-aware UI.
- **Actionable Observability:** Contextual errors, proactive notifications, and permission validation.

## Success Criteria

### User Success
*   **Trust & Autonomy:** Users can queue a batch of files and walk away, confident they will be processed without intervention.
*   **Actionable Feedback:** When errors occur, users receive specific, actionable instructions (e.g., "Rename file to remove emoji") rather than generic failure codes.
*   **Dashboard Truth:** Users trust that the status shown on the dashboard reflects the actual state of the system (no "zombie jobs").

### Business Success
*   **Operational Stability:** The system runs indefinitely without manual "hard resets" to clear Redis state.
*   **Zero "Whack-a-Mole":** Elimination of manual debugging sessions to clear stuck jobs.

### Technical Success (Hard Metrics)
*   **MTTR (Mean Time To Recovery):** < 30 seconds from system restart to accurate dashboard state.
*   **Data Consistency Score:** 100% match between files on disk and jobs in Redis/Dashboard.
*   **Ingestion Success Rate:** 100% of valid files dropped in Inbox result in created jobs.
*   **Contract Coverage:** 100% of API endpoints used by the frontend have corresponding contract tests.
*   **Observability Visibility:** Self-healing events (e.g., 'Zombie Job Killed') are logged with `WARN` level and visible in logs.

### Measurable Outcomes
*   **0** Zombie Jobs (jobs stuck in "Processing" state without an active worker).
*   **100%** of "Retry" attempts result in a fresh, clean ingestion state.

## Product Scope

### Phase 1: Stabilization & Hardening (Current Focus)
*   **Self-Healing Core:** Boot Reconciliation, Idempotent Re-ingest, and Disk-based Disaster Recovery.
*   **Robust Ingestion:** Basic input sanitization (path traversal protection) and atomic file operations.
*   **Integration Integrity:** Shared TypeScript definitions (OpenAPI) and basic contract tests.
*   **Actionable Errors:** Enhanced error reporting in the API and Dashboard.

### Phase 2: Growth & Enhancements
*   **Proactive Alerts:** Centralized email notification system for critical failures.
*   **Advanced UI:** Visual indicators for "Recovering" or "Reconciling" states in the dashboard.

### Vision (Future)
*   **Automated Chaos:** Continuous Chaos Testing in the CI pipeline.
*   **Maintenance UI:** Dedicated administrative interface for managing disk quotas and deep system states.

## User Journeys

**Journey 1: The "Set and Forget" Upload (Happy Path)**
You have a batch of 5 lecture recordings. You drop them into the `Inbox` folder and walk away.
*   **System Action:** `FileWatcher` sees files, sanitizes names (e.g., `Lecture #1.mp3` -> `Lecture_1.mp3`), and atomically moves them to `Processing`.
*   **Result:** You check the dashboard later. All 5 jobs are "Completed". The system handled the naming and processing without asking you for anything.

**Journey 2: The "Bad File" Recovery (Auto-Sanitization)**
You accidentally upload a file named `My Notes 📝.mp3`.
*   **System Action:** The system detects the emoji. Instead of failing, it automatically sanitizes the filename to `My_Notes_.mp3`, logs a warning, and proceeds with ingestion.
*   **Result:** The job succeeds. You see a notification in the dashboard: *"File 'My Notes 📝.mp3' was renamed to 'My_Notes_.mp3' and processed successfully."* You are relieved you didn't have to re-upload.

**Journey 3: The "Hard Crash" (Cleanup & Restart)**
The power goes out while a job is 50% transcribed. Redis is wiped. You restart the server.
*   **System Action:** On boot, `ReconciliationService` finds the audio file in `Processing`. It checks for a partial transcript, **deletes it** to ensure no corruption, and re-queues the job as "Waiting".
*   **Result:** The dashboard shows the job as "Waiting" (not "Processing"), and it starts over. You get a clean, complete transcript, not a corrupted half-file.

**Journey 4: The "Safe Upgrade" (Decoupled Integrity)**
You add a new field to the Palantir API.
*   **System Action:** You run the tests. The **Contract Test** verifies that the new API matches the updated `openapi.json` spec.
*   **Result:** The dashboard team (you) simply regenerates their client from the spec. No hard build links, just a shared agreement on the data shape.

### Journey Requirements Summary
*   **Ingestion:** Auto-sanitization logic, atomic moves.
*   **Reconciliation:** Boot logic to scan disk, delete partial outputs, and re-queue jobs.
*   **Integration:** OpenAPI spec generation and contract testing pipeline.
*   **UI:** Notifications for auto-actions (renaming) and status updates.

## API Backend Specific Requirements

### Project-Type Overview
Transcription Palantir is a **Headless API Service** designed for internal network usage (Tailscale). It prioritizes **Observability** (Prometheus/Health checks) and **Reliability** over public-facing features like auth or rate limiting.

### Technical Architecture Considerations
*   **Network Security:** Relies on Tailscale Mesh VPN. No application-level authentication (API Keys/JWT) required.
*   **Versioning:** Uses URI Versioning (`/api/v1`) to allow safe, decoupled deployments of frontend and backend.
*   **State Sync Strategy:** **Polling Only.** WebSockets are explicitly **excluded** to reduce state complexity and ensure robust recovery after server restarts.

### Endpoint Specification
*   **Core Resources:** Jobs (CRUD + Retry), System Info (Whisper status).
*   **Observability:** Prometheus Metrics (`/metrics`), Detailed Health (`/health/detailed`).
*   **Contract Source:** `openapi.json` generated from Fastify schemas.

### Implementation Considerations
*   **Type Safety:** `openapi-typescript` used to generate strict TypeScript definitions for the frontend.
*   **Validation:** Zod/Fastify schemas used for runtime validation of all inputs.
*   **Documentation:** Swagger UI exposed at `/documentation` for easy manual testing.

## Project Scoping & Phased Development

### MVP Strategy & Philosophy
**Approach:** "Production Hardening" (Stabilization First).
**Philosophy:** We are not building new features; we are paying down technical debt to buy "Peace of Mind".

### Phase 1: Stabilization (Immediate)
**Core Focus:** Self-Healing & Integration Integrity.
*   **Must-Have:** Boot Reconciliation, Idempotent Re-ingest, Disk Disaster Recovery.
*   **Must-Have:** OpenAPI Spec Generation & Contract Tests.
*   **Must-Have:** Polling-based Dashboard State Sync.

### Phase 2: Growth (Post-Stabilization)
**Core Focus:** Proactive Observability & User Experience.
*   **Enhancement:** Centralized Email Notifications.
*   **Enhancement:** "Recovering" UI states in Dashboard.

### Risk Mitigation Strategy
*   **Technical Risk (Fake Stability):** Mitigated by **Chaos Testing** (manually wiping Redis) during QA to prove recovery works.
*   **Integration Risk (Breaking Changes):** Mitigated by **Contract Tests** running in CI before any merge.

## Functional Requirements

### Job Management
*   **FR1:** API Clients can create a new transcription job by uploading an audio file.
*   **FR2:** API Clients can retrieve the status and progress of a specific job.
*   **FR3:** API Clients can list all jobs with pagination and status filtering.
*   **FR4 (Robust Retry):** API Clients can explicitly **Retry** a failed job. This action must:
    *   Reset the job status to `Waiting`.
    *   Clear any previous `errorReason`.
    *   **Be Idempotent:** If the job is already `Processing` or `Waiting`, the retry request must be ignored.
*   **FR5:** API Clients can delete a job and its associated artifacts.

### Ingestion & Processing
*   **FR6:** The System must automatically sanitize filenames containing invalid characters upon ingestion.
*   **FR7:** The System must prevent duplicate processing of the same file (idempotency).
*   **FR8:** The System must process audio files using Whisper.cpp.

### System Health & Self-Healing
*   **FR9:** The System must automatically detect and reconcile "orphaned" files on startup.
*   **FR10:** The System must delete partial/corrupted transcripts before restarting a job.
*   **FR11:** API Clients can retrieve detailed system health (including Whisper binary status).
*   **FR12:** The System must expose Prometheus-compatible metrics at `/metrics`.

### Integration & Contracts
*   **FR13:** The System must expose an OpenAPI v3 specification at `/documentation/json`.
*   **FR14:** The System must validate all API inputs against a strict schema.
*   **FR15:** The System must publish its OpenAPI specification in a format strictly compatible with `openapi-typescript`.
*   **FR16 (Schema Parity):** The runtime validation logic (Zod) must exactly match the published OpenAPI document.
*   **FR17:** The System must not introduce breaking changes to existing `v1` endpoints without a version increment.

### Data Accuracy & Dashboard Support
*   **FR18 (State Truthfulness):** The System must ensure the number of jobs in `Processing` state **NEVER** exceeds the configured `CONCURRENCY_LIMIT`.
    *   *Constraint:* If the database reports excess processing jobs, the System must automatically detect and mark them as `Stalled` or `Failed`.
*   **FR19:** The System must provide accurate `total` counts in pagination metadata.
*   **FR20:** The System must expose a `healthStatus` field for each job (e.g., `Healthy`, `Stalled`, `Recovered`).

### Error Handling & Manual Control
*   **FR21:** The System must record and expose a human-readable `errorReason` and a machine-readable `errorCode` for all failed jobs.
*   **FR22 (Reactive State):** If a job status is manually updated to `Waiting` via API, the System must automatically re-inject the job into the processing queue.

## Non-Functional Requirements

### Reliability & Recovery
*   **NFR1 (MTTR):** The System must recover from a hard crash (process kill) and resume processing pending jobs within **30 seconds** of restart.
*   **NFR2 (Data Integrity):** The System must achieve **100% Consistency** between the Disk State and the Database State after the boot reconciliation process completes.

### Observability
*   **NFR3 (Log Visibility):** All self-healing events (e.g., "Deleted partial file", "Re-queued job") must be logged at `WARN` level to ensure visibility in logs.
*   **NFR4 (Metric Granularity):** Prometheus metrics must be scraped/updated at least every **15 seconds** to provide near-real-time visibility.

### Performance
*   **NFR5 (Concurrency):** The System must support a configurable `CONCURRENCY_LIMIT` (default: **3**) to prevent CPU starvation of the host machine.
*   **NFR6 (Ingestion Latency):** New files dropped in the `Inbox` must be detected and ingested within **5 seconds**.
