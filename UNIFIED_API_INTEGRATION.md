# 🔮 Unified API Integration Plan

## Current Architecture vs. Recommended

### **Current: Standalone API Server**
```
Transcription Palantir (Port 3001)
├── Fastify Server
├── API Routes (/api/v1/*)
├── Swagger Docs (/docs)
├── WebSocket (/ws)
└── Background Services
    ├── File Watcher
    ├── Workers
    └── Queue
```

### **Recommended: Unified API Integration**
```
Mithrandir Unified API (Port 3000)
├── /api/transcription/*  ← Integrated routes
│   ├── /jobs
│   ├── /health
│   ├── /metrics
│   └── /monitor
└── Background Services (Separate Processes)
    ├── File Watcher Service
    ├── Transcription Workers
    └── Queue Management
```

## Implementation Steps

### **Phase 1: Extract Service Layer**
Create service classes that can be used by any API:

```typescript
// src/services/transcription-api.ts
export class TranscriptionApiService {
  async createJob(data: JobCreateData): Promise<TranscriptionJob>
  async getJobs(filters: JobFilters): Promise<PaginatedResponse<TranscriptionJob>>
  async getJob(id: string): Promise<TranscriptionJob>
  async updateJob(id: string, updates: JobUpdates): Promise<TranscriptionJob>
  async deleteJob(id: string): Promise<void>
  async getSystemHealth(): Promise<SystemHealth>
  async getMetrics(): Promise<MetricsData>
}
```

### **Phase 2: Create Unified API Routes**
Convert Fastify routes to your unified API format:

```typescript
// For your unified API
export const transcriptionRoutes = {
  'GET /api/transcription/jobs': listJobs,
  'POST /api/transcription/jobs': createJob,
  'GET /api/transcription/jobs/:id': getJob,
  'PUT /api/transcription/jobs/:id': updateJob,
  'DELETE /api/transcription/jobs/:id': deleteJob,
  'GET /api/transcription/health': getHealth,
  'GET /api/transcription/metrics': getMetrics,
}
```

### **Phase 3: Background Services**
Keep these as separate processes:

```bash
# Background services (separate from API)
bun run services/file-watcher.ts
bun run services/transcription-workers.ts
bun run services/queue-manager.ts
```

## Benefits of Unified Integration

### **For Clients**
- ✅ Single API endpoint (mithrandir.com/api/*)
- ✅ Unified authentication
- ✅ Consistent error handling
- ✅ Single API documentation

### **For Operations**
- ✅ Centralized logging and monitoring
- ✅ Unified rate limiting and security
- ✅ Single deployment pipeline
- ✅ Consistent API patterns

### **For Development**
- ✅ Shared middleware and utilities
- ✅ Consistent validation patterns
- ✅ Unified testing approach
- ✅ Single API gateway

## Migration Strategy

### **Option A: Full Integration (Recommended)**
1. Extract service layer from current API
2. Create unified API routes
3. Deploy background services separately
4. Retire standalone API server

### **Option B: Hybrid Approach**
1. Keep standalone API for development/testing
2. Add unified API routes for production
3. Gradually migrate clients
4. Eventually retire standalone API

## File Structure After Integration

```
transcription-palantir/
├── src/
│   ├── services/
│   │   ├── transcription-api.ts     ← Service layer
│   │   ├── queue.ts                 ← Queue management
│   │   └── file-watcher.ts          ← File monitoring
│   ├── workers/
│   │   └── transcription-worker.ts  ← Background workers
│   ├── routes/                      ← For unified API
│   │   └── transcription.ts         ← Route handlers
│   └── standalone/                  ← Optional: keep for dev
│       └── api-server.ts            ← Current Fastify server
└── scripts/
    ├── start-file-watcher.ts        ← Background service
    ├── start-workers.ts             ← Background service
    └── start-api-server.ts          ← Optional: standalone mode
```

## Deployment Architecture

### **Production (Mithrandir)**
```
┌─────────────────────────────────────┐
│         Mithrandir Server           │
│                                     │
│  ┌─────────────────────────────────┐│
│  │      Unified API (Port 3000)   ││
│  │   /api/transcription/*          ││
│  └─────────────────────────────────┘│
│                                     │
│  ┌─────────────────────────────────┐│
│  │     Background Services         ││
│  │  • File Watcher                 ││
│  │  • Transcription Workers        ││
│  │  • Queue Management             ││
│  └─────────────────────────────────┘│
│                                     │
│  ┌─────────────────────────────────┐│
│  │         Redis Queue             ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

## Next Steps

1. **Decide on integration approach** (Full vs. Hybrid)
2. **Extract service layer** from current API routes
3. **Create unified API routes** for your main API
4. **Test integration** with background services
5. **Deploy to Mithrandir** with unified endpoints

Would you like me to start implementing the service layer extraction?
