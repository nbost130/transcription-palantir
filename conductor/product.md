# Transcription Palantir — Product Context

## Purpose
Transform Transcription Palantir from a fragile, happy‑path prototype into a robust, self‑healing production system. The system must recover reliably after crashes, preserve user trust, and keep integration contracts in sync across the Mithrandir ecosystem.

## Product Summary
- **Type**: Backend API service (internal, Tailscale)
- **Domain**: Reliability engineering for transcription workflows
- **Current pain**: “Whack‑a‑mole” instability (stuck jobs, broken status, fragile restarts)
- **Target state**: Self‑healing, disk‑reconcilable, contract‑safe, observable system

## Users
- Internal operators who drop audio in `Inbox` and expect completion without manual intervention
- Developer consumers (Mithrandir Unified API, dashboard) relying on consistent API contracts

## Goals
- **Self‑healing**: Recover after restarts without manual Redis resets
- **Truthful dashboard**: UI reflects actual job state on disk and in queue
- **Integration integrity**: API contracts enforced at build time via OpenAPI
- **Actionable errors**: Users receive fixable guidance, not vague failure states

## Non‑Goals (for Phase 1)
- WebSocket streaming updates (polling only)
- New feature surfaces unrelated to stability
- Public auth or rate limiting (internal only)

## Success Criteria (Phase 1)
- **MTTR** < 30s from restart to accurate state
- **Data consistency**: 100% match between disk and job states
- **No zombie jobs**: Processing count never exceeds concurrency limit
- **Contract coverage**: 100% of used endpoints have contract tests

## Constraints & Guardrails
- Internal service on Tailnet only (no public auth)
- **Polling only** for UI state sync
- **API versioning**: no breaking changes to `/api/v1` without version bump
- **Contracts** generated from OpenAPI (Fastify schemas)
- Prefer deterministic recovery to “best effort” heuristics

## Architecture Direction
- **Disk‑based source of truth** with reconciliation on boot
- **Redis/BullMQ as optimization**, not authority
- **Atomic file operations** for ingestion and recovery safety
- **Strict API schemas** + generated TypeScript clients

## Key Flows
1. **Ingestion**: sanitize filenames → atomic move → queue job
2. **Processing**: job updates are mirrored to disk
3. **Reconciliation**: on startup, scan disk → kill or re‑queue orphaned jobs
4. **Error reporting**: structured error codes + human guidance

## Risks & Mitigations
- **False recovery**: validate file states before re‑queue
- **Contract drift**: add CI contract tests against OpenAPI
- **State desync**: enforce concurrency invariant and auto‑mark stalled jobs

## References
- PRD: `/Users/nbost/dev/transcription-palantir/_bmad-output/planning-artifacts/prd.md`
