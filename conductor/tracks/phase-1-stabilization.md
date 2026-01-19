# Track: Phase 1 — Stabilization & Hardening

## Objective
Deliver the self‑healing, contract‑safe foundation described in the PRD. Eliminate zombie jobs, make disk the recovery source of truth, and enforce API contracts.

## Scope
### Must‑Have
- Boot reconciliation and idempotent re‑ingest
- Disk‑based disaster recovery (delete partial transcripts)
- Filename sanitization and atomic ingestion
- OpenAPI spec generation + contract tests
- Actionable error reporting
- Accurate polling‑based dashboard state

### Out of Scope
- WebSockets or push updates
- New public auth/keys
- Feature expansions unrelated to reliability

## Requirements (from PRD)
### Ingestion & Processing
- **FR6** sanitize invalid filenames on ingestion
- **FR7** idempotent processing (prevent duplicates)
- **FR8** process audio with Whisper

### System Health & Self‑Healing
- **FR9** detect orphaned files on startup
- **FR10** delete partial/corrupted transcripts before restart
- **FR11** detailed health endpoint
- **FR12** Prometheus metrics at `/metrics`

### Integration & Contracts
- **FR13** OpenAPI v3 spec at `/documentation/json`
- **FR14** strict input validation
- **FR15** OpenAPI compatible with `openapi-typescript`
- **FR16** schema parity between runtime validation and spec
- **FR17** no breaking changes to `/api/v1`

### Data Accuracy & Dashboard Support
- **FR18** processing count never exceeds concurrency limit
- **FR19** accurate pagination totals
- **FR20** job `healthStatus` field

### Error Handling
- **FR21** structured error codes + human‑readable reasons
- **FR22** re‑inject job on manual status update to `Waiting`

## Implementation Plan (Suggested)
1. **Reconciliation Service**
   - Scan disk on startup
   - Identify orphaned/limbo files
   - Re‑queue or mark stalled
   - Enforce concurrency invariant
2. **Ingestion Hardening**
   - Sanitize filenames
   - Atomic moves into processing
   - Idempotent guards for duplicates
3. **Contract Integrity**
   - Generate OpenAPI from Fastify schemas
   - Add contract tests in CI
   - Generate TS types for consumers
4. **Actionable Errors**
   - Add `errorCode` + `errorReason`
   - Dashboard notification copy

## Acceptance Criteria
- Restart yields accurate dashboard state within 30 seconds
- No jobs remain “Processing” without an active worker
- Orphaned files are re‑queued or marked failed with reasons
- Contract tests fail on breaking changes to `/api/v1`
- Auto‑sanitized filenames are logged and visible

## Dependencies / Inputs
- PRD: `/Users/nbost/dev/transcription-palantir/_bmad-output/planning-artifacts/prd.md`
- System context: `/Users/nbost/dev/transcription-palantir/CLAUDE.md`
