# Story 1.1: Create HealthStatus Enum and Types

**Epic:** Epic 1: Self-Healing Boot & Recovery
**Status:** ready-for-dev

As a **developer**,
I want to define the `HealthStatus` enum and supporting types,
So that job health can be consistently represented across the system.

**Acceptance Criteria:**

**Given** I am implementing health status tracking
**When** I create the `HealthStatus` enum in `src/types/health-status.ts`
**Then** it must export the following values: `Healthy`, `Stalled`, `Recovered`, `Unknown`
**And** the enum must be a TypeScript string literal union type
**And** the file must export a type guard function `isValidHealthStatus(value: string): value is HealthStatus`
