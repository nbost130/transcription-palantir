# API Versioning Policy

## Overview

The Transcription Palantir API uses **semantic versioning** with URL-based version prefixes to ensure backward compatibility and smooth upgrades for API consumers.

## Current Version

**All endpoints use the `/api/v1/*` prefix.**

Example endpoints:
- `GET /api/v1/jobs`
- `POST /api/v1/jobs`
- `GET /api/v1/health`
- `GET /api/v1/metrics`

## Versioning Rules

### Breaking Changes

**Breaking changes require a new version prefix** (e.g., `/api/v2/*`).

Examples of breaking changes:
- Removing an endpoint
- Removing a required field
- Changing a field's data type
- Changing the meaning of a field
- Changing error response format
- Renaming fields

**When introducing breaking changes:**
1. Create new endpoints under `/api/v2/*`
2. Keep `/api/v1/*` endpoints unchanged
3. Support both versions simultaneously during transition period
4. Document migration path in release notes
5. Announce deprecation timeline for v1

### Non-Breaking Changes

**Non-breaking changes can be added to existing version** (`/api/v1/*`).

Examples of non-breaking changes:
- Adding a new endpoint
- Adding an optional field
- Adding a new enum value
- Expanding error messages
- Adding new response fields

**When making non-breaking changes:**
1. Add to existing `/api/v1/*` endpoints
2. Ensure existing clients continue to work
3. Document new features in release notes
4. Update OpenAPI spec

## Version Support Policy

- **Current version** (v1): Fully supported, receives all updates
- **Previous version** (when v2 exists): Supported for 6 months after v2 release
- **Deprecated versions**: Security fixes only, no new features

## Migration Guide Template

When releasing a new major version, provide a migration guide:

```markdown
# Migrating from v1 to v2

## Breaking Changes

### 1. Job Status Field Renamed
- **v1**: `status` (string)
- **v2**: `jobStatus` (enum)
- **Migration**: Update client code to use `jobStatus` instead of `status`

### 2. Pagination Format Changed
- **v1**: `{ data: [], total: number }`
- **v2**: `{ data: [], pagination: { total, page, limit } }`
- **Migration**: Update pagination parsing logic

## New Features in v2

- Real-time job updates via WebSocket
- Batch job operations
- Enhanced error codes

## Timeline

- **2024-01-01**: v2 released, v1 still fully supported
- **2024-04-01**: v1 deprecated, security fixes only
- **2024-07-01**: v1 sunset, no longer supported
```

## Contract Testing

The API contract is enforced through:

1. **OpenAPI Specification**: Auto-generated from Zod schemas
2. **TypeScript Types**: Generated from OpenAPI spec using `openapi-typescript`
3. **Runtime Validation**: Zod schemas validate all requests
4. **Schema Parity**: Zod schemas are the single source of truth

See [Consumer Type Generation](./CONSUMER_TYPE_GENERATION.md) for details on using the OpenAPI spec.

## Version Detection

Clients can detect the API version from:
- URL prefix: `/api/v1/*` or `/api/v2/*`
- Response header: `X-API-Version: 1.0.0`
- Root endpoint: `GET /` returns `{ version: "1.0.0" }`

## Questions?

For questions about API versioning or migration support, please open an issue on GitHub.
