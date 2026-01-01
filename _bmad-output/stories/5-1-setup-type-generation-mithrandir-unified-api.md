# Story 5.1: Setup Type Generation in mithrandir-unified-api

**Epic:** Epic 5 - Consumer Integration (Future)  
**Repository:** mithrandir-unified-api  
**Status:** Backlog  
**Story Points:** 2  
**Priority:** Medium

## User Story

As a **developer** working on mithrandir-unified-api,  
I want to automatically generate TypeScript types from the Transcription Palantir API,  
So that I have type-safe API client code with compile-time contract enforcement.

## Context

The Transcription Palantir API now exposes a complete OpenAPI v3 specification at `/documentation/json`. This story implements type generation in the mithrandir-unified-api consumer repository.

## Prerequisites

- Transcription Palantir API must be running and accessible
- OpenAPI spec must be available at `http://palantir.tailnet:3001/documentation/json`

## Acceptance Criteria

### AC1: Install Dependencies
- [ ] Add `openapi-typescript` as a dev dependency
- [ ] Verify installation: `npm list openapi-typescript`

### AC2: Add Type Generation Script
- [ ] Add script to `package.json`: `"generate:types": "openapi-typescript http://palantir.tailnet:3001/documentation/json -o src/types/palantir.d.ts"`
- [ ] Create `src/types/` directory if it doesn't exist
- [ ] Add `.gitkeep` to `src/types/` directory

### AC3: Generate Initial Types
- [ ] Run `npm run generate:types`
- [ ] Verify `src/types/palantir.d.ts` is created
- [ ] Verify file contains TypeScript type definitions
- [ ] Commit the generated file to version control

### AC4: Update Documentation
- [ ] Add "API Type Generation" section to README.md
- [ ] Document how to regenerate types
- [ ] Explain when to regenerate (after API updates)
- [ ] Add example usage of generated types

### AC5: Verify Type Safety
- [ ] Import types in existing API client code
- [ ] Add type annotations using generated types
- [ ] Run `npm run type-check` (or `tsc --noEmit`)
- [ ] Verify TypeScript compilation succeeds

## Technical Notes

**Files to Create/Modify:**
- `package.json` - Add script and dependency
- `src/types/palantir.d.ts` - Generated types file (commit this!)
- `README.md` - Add documentation section

**Example Usage:**
```typescript
import type { paths, components } from './types/palantir';

type JobsResponse = paths['/api/v1/jobs']['get']['responses']['200']['content']['application/json'];
type Job = components['schemas']['Job'];

async function getJobs(): Promise<JobsResponse> {
  const response = await fetch('http://palantir.tailnet:3001/api/v1/jobs');
  return response.json();
}
```

## Definition of Done
- [ ] All acceptance criteria met
- [ ] Types successfully generated
- [ ] Documentation updated
- [ ] TypeScript compilation passes
- [ ] Changes committed and pushed

## References
- [Transcription Palantir: Consumer Type Generation Guide](https://github.com/nbost130/transcription-palantir/blob/main/docs/CONSUMER_TYPE_GENERATION.md)
- [openapi-typescript Documentation](https://github.com/drwpow/openapi-typescript)
