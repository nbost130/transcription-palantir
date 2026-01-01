# Consumer Type Generation

## Overview

The Transcription Palantir API provides an OpenAPI v3 specification that can be used to automatically generate TypeScript types for consumer applications. This ensures type safety and contract enforcement between the API and its consumers.

## Quick Start

### 1. Install openapi-typescript

```bash
npm install --save-dev openapi-typescript
```

### 2. Add Type Generation Script

Add to your `package.json`:

```json
{
  "scripts": {
    "generate:types": "openapi-typescript http://palantir.tailnet:3001/documentation/json -o src/types/palantir.d.ts"
  }
}
```

### 3. Generate Types

```bash
npm run generate:types
```

This creates `src/types/palantir.d.ts` with TypeScript definitions for all API endpoints and schemas.

### 4. Use Generated Types

```typescript
import type { paths, components } from './types/palantir';

// Type-safe API client
type JobsResponse = paths['/api/v1/jobs']['get']['responses']['200']['content']['application/json'];
type CreateJobRequest = paths['/api/v1/jobs']['post']['requestBody']['content']['application/json'];
type Job = components['schemas']['Job'];

// Example usage
async function getJobs(): Promise<JobsResponse> {
  const response = await fetch('http://palantir.tailnet:3001/api/v1/jobs');
  return response.json(); // TypeScript knows the shape!
}
```

## Workflow

### Development Workflow

1. **API Changes**: Transcription Palantir API is updated
2. **Regenerate Types**: Run `npm run generate:types` in consumer repo
3. **TypeScript Compilation**: Compiler catches breaking changes
4. **Fix Client Code**: Update consumer code to match new contract
5. **Commit Types**: Commit the generated `palantir.d.ts` file

### Contract Enforcement

The generated types enforce the API contract at compile time:

**✅ Prevents runtime errors:**
```typescript
// TypeScript error: Property 'invalidField' does not exist
const job: Job = {
  invalidField: 'value' // ❌ Compile error!
};
```

**✅ Catches breaking changes:**
```typescript
// If API removes a field, TypeScript compilation fails
const status = job.removedField; // ❌ Compile error!
```

**✅ Autocomplete and IntelliSense:**
```typescript
const job: Job = {
  // IDE suggests: jobId, fileName, status, priority, etc.
};
```

## Configuration Options

### Custom Output Path

```json
{
  "scripts": {
    "generate:types": "openapi-typescript http://palantir.tailnet:3001/documentation/json -o src/api/types.d.ts"
  }
}
```

### Local Development

For local development, use localhost:

```json
{
  "scripts": {
    "generate:types": "openapi-typescript http://localhost:3001/documentation/json -o src/types/palantir.d.ts"
  }
}
```

### Multiple Environments

```json
{
  "scripts": {
    "generate:types:dev": "openapi-typescript http://localhost:3001/documentation/json -o src/types/palantir.d.ts",
    "generate:types:staging": "openapi-typescript http://staging.palantir:3001/documentation/json -o src/types/palantir.d.ts",
    "generate:types:prod": "openapi-typescript http://palantir.tailnet:3001/documentation/json -o src/types/palantir.d.ts"
  }
}
```

## Best Practices

### 1. Commit Generated Types

**Always commit the generated `palantir.d.ts` file** to version control. This ensures:
- Team members have consistent types
- CI/CD can type-check without running the API
- Historical record of API changes

### 2. Regenerate After API Updates

After updating the Transcription Palantir API:
1. Deploy the API changes
2. Regenerate types in all consumer repos
3. Fix any TypeScript compilation errors
4. Test the integration
5. Deploy consumer changes

### 3. Use in CI/CD

Add type generation to your CI pipeline:

```yaml
# .github/workflows/ci.yml
- name: Generate API Types
  run: npm run generate:types
  
- name: Type Check
  run: npm run type-check
```

### 4. Version Compatibility

When the API introduces breaking changes (v2):
- Update the URL in your generation script
- Regenerate types
- Fix compilation errors
- Test thoroughly before deploying

## Troubleshooting

### Error: Cannot connect to API

**Problem**: `openapi-typescript` can't reach the API server.

**Solutions**:
- Ensure the API is running: `curl http://palantir.tailnet:3001/documentation/json`
- Check network connectivity
- Verify the URL in your script
- For local development, use `http://localhost:3001`

### Error: Invalid OpenAPI spec

**Problem**: The generated spec is invalid.

**Solutions**:
- Check API logs for errors
- Validate the spec: `npx swagger-cli validate http://palantir.tailnet:3001/documentation/json`
- Report the issue to the API team

### Types Don't Match Runtime Behavior

**Problem**: Generated types don't match actual API responses.

**This indicates a bug in the API** - the OpenAPI spec doesn't match the implementation. Please:
1. Document the discrepancy
2. Report it to the API team
3. The API should be fixed to match the spec (not the other way around)

## Example: Complete Integration

```typescript
// src/api/palantir-client.ts
import type { paths } from './types/palantir';

type JobsAPI = paths['/api/v1/jobs'];
type GetJobsResponse = JobsAPI['get']['responses']['200']['content']['application/json'];
type CreateJobRequest = JobsAPI['post']['requestBody']['content']['application/json'];

class PalantirClient {
  constructor(private baseUrl: string) {}

  async getJobs(params?: { page?: number; limit?: number }): Promise<GetJobsResponse> {
    const url = new URL('/api/v1/jobs', this.baseUrl);
    if (params?.page) url.searchParams.set('page', String(params.page));
    if (params?.limit) url.searchParams.set('limit', String(params.limit));
    
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async createJob(data: CreateJobRequest): Promise<void> {
    const url = new URL('/api/v1/jobs', this.baseUrl);
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }
}

// Usage
const client = new PalantirClient('http://palantir.tailnet:3001');
const jobs = await client.getJobs({ page: 1, limit: 20 });
// TypeScript knows: jobs.data, jobs.pagination, etc.
```

## Support

For questions or issues with type generation:
- Check the [openapi-typescript documentation](https://github.com/drwpow/openapi-typescript)
- Review the [API Versioning Policy](./API_VERSIONING.md)
- Open an issue on the Transcription Palantir GitHub repository
