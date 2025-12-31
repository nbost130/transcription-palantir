---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - /Users/nbost/dev/transcription-palantir/_bmad-output/planning-artifacts/prd.md
  - /Users/nbost/dev/transcription-palantir/_bmad-output/project-context.md
  - /Users/nbost/dev/transcription-palantir/_bmad-output/api-contracts.md
  - /Users/nbost/dev/transcription-palantir/docs/transcription-overhaul-plan.md
workflowType: 'architecture'
project_name: 'transcription-palantir'
user_name: 'Nathan'
date: '2025-12-30'
status: 'complete'
completedAt: '2025-12-31'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements (22 Total):**
The system focuses on **Job Management** and **Self-Healing**. Key FRs include:
- **FR4 (Robust Retry):** Idempotent retry logic that resets state.
- **FR9 (Orphaned File Reconciliation):** On startup, scan disk and create jobs for untracked files.
- **FR10 (Partial File Cleanup):** Delete incomplete transcripts before restart.
- **FR18 (State Truthfulness):** Detect and mark "zombie" processing jobs.
- **FR22 (Reactive State):** Manual status updates must trigger queue re-injection.

**Non-Functional Requirements (6 Total):**
- **NFR1 (MTTR < 30s):** Recovery time is a hard constraint.
- **NFR2 (100% Data Consistency):** Disk = Database after reconciliation.
- **NFR5 (Concurrency = 3):** Max 3 parallel Whisper processes.

### Scale & Complexity
- **Primary Domain:** Backend API / Reliability Engineering
- **Complexity Level:** Medium
- **Estimated Architectural Components:** 6-8

### Technical Constraints & Dependencies
- **Existing Stack:** TypeScript, Fastify, BullMQ, IORedis, Whisper.cpp
- **External Dependency:** Whisper.cpp CLI binary must be present on host.
- **Network:** Internal Tailscale only (no external auth required).

### Directory Structure Convention
The system relies on the following folder structure (already implemented):
- `Inbox/` (WATCH_DIRECTORY) - Files dropped here, remain here during processing
- `Transcripts/` (OUTPUT_DIRECTORY) - Output .txt/.vtt files
- `Completed/` (COMPLETED_DIRECTORY) - Source audio after success (optional)
- `Failed/` (FAILED_DIRECTORY) - Source audio after failure

> **Note:** There is NO "Processing" folder. Redis/BullMQ tracks processing state; files stay in Inbox until complete.

### Cross-Cutting Concerns
- **Startup Orchestration:** `ReconciliationService` must complete *before* `FileWatcher` starts.
- **Observability:** All self-healing events at `WARN` level.
- **File System Atomicity:** All file moves must be atomic (rename, not copy+delete).
- **Contract Parity:** Zod schemas must match OpenAPI output.

### Test Invariants
- **Post-Boot Consistency:** After restart, `count(Inbox/*.mp3 tracked by Redis) == count(Redis jobs in Waiting or Processing)`.

## Starter Template Evaluation (Brownfield Adaptation)

### Primary Technology Domain
**Backend API / Reliability Engineering** — Existing TypeScript/Fastify/BullMQ system.

### Existing Stack (Already Established)
Since this is a **brownfield** project, the technology stack is already defined:

| Category | Technology | Status |
|----------|------------|--------|
| Language | TypeScript | ✅ Established |
| Runtime | Node.js / Bun | ✅ Established |
| API Framework | Fastify | ✅ Established |
| Queue System | BullMQ | ✅ Established |
| Data Store | Redis (IORedis) | ✅ Established |
| Validation | Zod | ✅ Established |
| Logging | Pino | ✅ Established |
| Testing | Vitest | ✅ Established |
| Transcription | Whisper.cpp (CLI) | ✅ Established |

### New Dependencies Required (Phase 1)

| Dependency | Purpose | System |
|------------|---------|--------|
| `openapi-typescript` | Generate TS types from OpenAPI spec | Consumer repos |

### Contract Testing Framework

**Approach:** Custom Vitest + openapi-typescript (Minimal)

**How It Works:**

```
transcription-palantir → /documentation/json (OpenAPI spec)
                              ↓
            npx openapi-typescript <URL> -o types/palantir.d.ts
                              ↓
           Consumer repos commit generated types
                              ↓
           TypeScript compilation = Contract enforcement
```

**One Command. One File. Done.**

```bash
# In consumer repos:
npx openapi-typescript http://palantir.tailnet:3001/documentation/json -o src/types/palantir.d.ts
```

### Cross-System Integration Plan (Simplified)

| System | Action |
|--------|--------|
| `transcription-palantir` | Ensure `/documentation/json` is stable |
| `mithrandir-unified-api` | Add `npm run generate:types` script, commit output |
| `mithrandir-admin` | Add `npm run generate:types` script, commit output |

### Starter Rationale
**No new starter template applies.** We are extending the existing system, not creating a new one.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Made in This Session):**
1. Reconciliation Service Architecture
2. Stalled Job Detection Strategy
3. Atomic File Move Strategy

**Already Decided (Existing Stack):**
- Redis/BullMQ for queue management
- Zod for validation
- Tailscale for network security (no app-level auth)
- Polling-only state sync (no WebSockets)

### Decision #1: Reconciliation Service

| Aspect | Decision |
|--------|----------|
| **Location** | `src/services/reconciliation.ts` (standalone service) |
| **Invocation** | Called from `index.ts` boot sequence, before FileWatcher starts |
| **Rationale** | Single Responsibility, Testability, Startup Orchestration |

### Decision #2: Stalled Job Detection

| Aspect | Decision |
|--------|----------|
| **Mechanism** | BullMQ built-in (`stalledInterval`, `maxStalledCount`, `lockDuration`) |
| **Configuration** | `stalledInterval: 30000`, `maxStalledCount: 2`, `lockDuration: 60000` |
| **Rationale** | No custom code needed; BullMQ handles this natively |

### Decision #3: Atomic File Moves

| Aspect | Decision |
|--------|----------|
| **Pattern** | Temp File + Rename (`copy to .tmp`, then `rename`) |
| **Fallback** | On `EXDEV` error, use copy-rename instead of direct rename |
| **Rationale** | Guarantees atomicity even across different filesystems |

### Implementation Utilities Required

- `src/utils/file-operations.ts` — Contains `atomicMove()` helper for cross-filesystem atomic moves.

## Implementation Patterns & Consistency Rules

### Existing Patterns (Brownfield)
Since this is an existing codebase, we adhere to established patterns:

| Category | Pattern | Example |
|----------|---------|---------|
| **File Naming** | kebab-case | `file-watcher.ts`, `queue.ts` |
| **Class Naming** | PascalCase | `FileWatcher`, `TranscriptionQueue` |
| **Function Naming** | camelCase | `getQueueStats()`, `reconcileOnBoot()` |
| **API Routes** | Plural nouns | `/jobs`, `/jobs/:jobId/retry` |
| **API Response** | `{ success, data, error? }` | Standardized wrapper |
| **Config** | Zod + `appConfig` | Single source of truth |
| **Logging** | Pino (JSON) | `logger.info({ jobId }, 'msg')` |
| **Tests** | Co-located in `tests/` | `tests/unit/`, `tests/integration/` |

### New Patterns (Standardized)

**Error Codes (FR21):**
- **Format:** `ERR_<CATEGORY>_<DETAIL>`
- **Examples:** `ERR_WHISPER_CRASH`, `ERR_FILE_INVALID`, `ERR_JOB_STALLED`

**Self-Healing Logs (NFR3):**
- **Format:** `[SELF-HEAL] <Message>` at `WARN` level.
- **Example:** `logger.warn({ jobId }, '[SELF-HEAL] Job recovered from stalled state')`

**Health Status Enum (FR20):**
- **Values:**
    - `Healthy` (Normal operation)
    - `Stalled` (Detected as stalled by BullMQ)
    - `Recovered` (Was stalled, now fixed)
    - `Unknown` (Fallback/Error state)
- **Computation:** `healthStatus` is computed dynamically in API responses (`GET /jobs`, `GET /jobs/:id`) based on BullMQ stalled events, NOT stored in job data.

**Pagination Accuracy (FR19):**
- `getJobs()` must use BullMQ's `getJobCounts()` for accurate totals.
- Do NOT infer totals from `jobs.length`—use queue statistics for ground truth.

**Reactive State (FR22):**
- When `updateJobStatus('waiting')` is called via API, the system must call `queue.add()` or `job.retry()` to re-inject the job into the processing queue.
- This is NOT a passive state change—it triggers active queue insertion.

### Enforcement Guidelines
- **All Agents MUST** use `ERR_` prefix for any new error codes defined.
- **All Agents MUST** use `[SELF-HEAL]` prefix for any recovery logic logging.
- **All Agents MUST** use the strict `HealthStatus` enum for job health reporting.
- **All Agents MUST** compute `healthStatus` dynamically, never store it.

## Project Structure & Boundaries

### Complete Project Directory Structure

```
transcription-palantir/
├── package.json
├── tsconfig.json
├── .env.example
├── docs/
│   └── openapi.json             # [AUTO-GEN] OpenAPI spec served via API
├── src/
│   ├── index.ts                 # App entry point (Boot sequence)
│   ├── config/
│   │   └── index.ts             # Zod configuration
│   ├── api/
│   │   ├── server.ts            # Fastify server setup (@fastify/swagger)
│   │   └── routes/
│   │       ├── jobs.ts          # Job management endpoints
│   │       ├── health.ts        # Health check endpoints
│   │       └── system.ts        # System stats
│   ├── services/
│   │   ├── queue.ts             # BullMQ wrapper (getJobCounts for pagination)
│   │   ├── file-watcher.ts      # Chokidar wrapper
│   │   ├── reconciliation.ts    # [NEW] Startup reconciliation logic
│   │   ├── whisper.ts           # Whisper.cpp wrapper
│   │   └── file-tracker.ts      # Redis file tracking
│   ├── workers/
│   │   └── transcription-worker.ts # Job processor (stalledInterval config)
│   ├── utils/
│   │   └── file-operations.ts   # [NEW] Atomic move helpers
│   └── types/
│       ├── index.ts             # Shared types
│       └── health-status.ts     # [NEW] HealthStatus enum
└── tests/
    ├── unit/
    ├── integration/
    └── setup.ts
```

### Architectural Boundaries

**API Boundaries:**
- **External:** `/api/v1/*` (REST) - Public interface for Dashboard/Proxy.
- **Internal:** Direct service calls (e.g., `QueueService` calling `Redis`).

**Service Boundaries:**
- **ReconciliationService:** Exclusive owner of "Disk-to-Redis" sync at boot.
- **FileWatcher:** Exclusive owner of "New File" detection (runtime).
- **TranscriptionQueue:** Exclusive owner of BullMQ interactions.
- **TranscriptionWorker:** Exclusive owner of `whisper-cpp` process execution.

### Requirements to Structure Mapping

**Self-Healing (FR9, FR10):**
- Logic: `src/services/reconciliation.ts`
- Utilities: `src/utils/file-operations.ts`

**Contract Testing (FR15):**
- Spec Generation: `src/api/server.ts`
- Spec Output: `docs/openapi.json` (served via API)

**State Truthfulness (FR18):**
- Stalled Detection: Configured in `src/workers/transcription-worker.ts` (BullMQ settings).

### Integration Points

**Internal Communication:**
- Services communicate via direct method calls (Dependency Injection pattern).
- Worker communicates with Queue via Redis (BullMQ).

**Data Flow:**
1. File -> Inbox -> FileWatcher -> Queue (Waiting)
2. Worker -> Queue (Processing) -> Whisper -> Output File
3. Worker -> Queue (Completed/Failed) -> Move Source File

## Operational Considerations

### Ingestion Latency (NFR6: < 5s)
- **Mechanism:** Chokidar file watcher with `awaitWriteFinish` enabled.
- This debounces file events until the file is fully written, then immediately triggers ingestion.
- Under normal load, detection should be sub-second.

### Graceful Shutdown
- **Worker MUST** listen for `SIGTERM` and complete the current job before exiting.
- If the worker is killed mid-processing, BullMQ's stalled detection will recover the job.
- **Implementation:** Use `worker.close()` which waits for current jobs to finish.

### Chaos Testing (PRD Risk Mitigation)
- **Strategy:** Manually wipe Redis during QA to prove recovery works.
- This is a **manual QA step**, not automated in CI.
- Expected behavior: On restart, `ReconciliationService` scans disk and re-creates jobs.

### API Versioning Policy (FR17)
- **Current:** All endpoints are `/api/v1/*`.
- **Breaking changes** MUST introduce a new version prefix (`/api/v2`).
- Non-breaking additions (new optional fields, new endpoints) are allowed in `/v1`.

## Architecture Validation Results

### Coherence Validation ✅
- **Decision Compatibility:** All decisions work together (ReconciliationService → FileWatcher → Queue → Worker).
- **Pattern Consistency:** Naming, logging, and error patterns are consistent.
- **Structure Alignment:** Project structure supports all architectural decisions.

### Requirements Coverage Validation ✅
- **Functional Requirements:** All 22 FRs covered (including FR19, FR22 after review).
- **Non-Functional Requirements:** All 6 NFRs addressed (MTTR, Data Integrity, Observability, Concurrency, Ingestion).

### Implementation Readiness ✅
- **Decision Completeness:** All critical decisions documented with rationale.
- **Structure Completeness:** Complete directory tree with NEW files identified.
- **Pattern Completeness:** Error codes, health status, pagination, and reactive state all defined.

### Architecture Completeness Checklist

**✅ Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**✅ Architectural Decisions**
- [x] Critical decisions documented (3 new decisions)
- [x] Technology stack fully specified (brownfield)
- [x] Integration patterns defined
- [x] Performance considerations addressed

**✅ Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified (DI, BullMQ)
- [x] Process patterns documented (error handling, shutdown)

**✅ Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** ✅ READY FOR IMPLEMENTATION

**Confidence Level:** HIGH

**Key Strengths:**
- Leverages existing BullMQ capabilities (no reinventing the wheel)
- Clear service boundaries (ReconciliationService, FileWatcher, Worker)
- Minimal new dependencies (`openapi-typescript` only)
- Comprehensive operational considerations (graceful shutdown, chaos testing)

**First Implementation Priority:**
1. Create `src/services/reconciliation.ts`
2. Create `src/utils/file-operations.ts`
3. Create `src/types/health-status.ts`
4. Update `src/index.ts` boot sequence

## Architecture Completion Summary

### Workflow Completion
- **Architecture Decision Workflow:** COMPLETED ✅
- **Total Steps Completed:** 8
- **Date Completed:** 2025-12-31
- **Document Location:** `_bmad-output/planning-artifacts/architecture.md`

### Final Architecture Deliverables

**📋 Complete Architecture Document**
- All architectural decisions documented with rationale
- Implementation patterns ensuring AI agent consistency
- Complete project structure with all files and directories
- Requirements to architecture mapping
- Validation confirming coherence and completeness

**🏗️ Implementation Ready Foundation**
- 3 new architectural decisions made
- 8 implementation patterns defined
- 6-8 architectural components specified
- 22 FRs and 6 NFRs fully supported

**📚 AI Agent Implementation Guide**
- Technology stack (TypeScript, Fastify, BullMQ, Redis)
- Consistency rules that prevent implementation conflicts
- Project structure with clear boundaries
- Integration patterns and communication standards

### Implementation Handoff

**For AI Agents:**
This architecture document is your complete guide for implementing transcription-palantir. Follow all decisions, patterns, and structures exactly as documented.

**Development Sequence:**
1. Create `ReconciliationService` as standalone service
2. Create `atomicMove()` utility for file operations
3. Create `HealthStatus` enum for job health reporting
4. Update boot sequence in `index.ts`
5. Configure BullMQ stalled detection in worker
6. Generate and stabilize OpenAPI spec output

---

**Architecture Status:** ✅ READY FOR IMPLEMENTATION

**Next Phase:** Create Epics & Stories to begin implementation.
