# Data Models

## Job Models

### TranscriptionJob
Core entity representing a transcription task.
```typescript
interface TranscriptionJob {
  id: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  status: JobStatus;
  priority: JobPriority;
  progress: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;
  attempts: number;
  maxAttempts: number;
  error?: string;
  transcriptPath?: string;
  metadata: JobMetadata;
}
```

### JobStatus
Enum for job lifecycle states.
- `PENDING`: 'pending'
- `PROCESSING`: 'processing'
- `COMPLETED`: 'completed'
- `FAILED`: 'failed'
- `CANCELLED`: 'cancelled'
- `RETRYING`: 'retrying'

### JobPriority
Enum for processing priority.
- `URGENT`: 1 (Small files < 10MB)
- `HIGH`: 2 (Important content)
- `NORMAL`: 3 (Regular processing)
- `LOW`: 4 (Large files > 100MB)

### JobMetadata
Additional context for the job.
```typescript
interface JobMetadata {
  originalPath: string;
  audioFormat: string;
  audioDuration?: number;
  audioChannels?: number;
  audioSampleRate?: number;
  whisperModel: string;
  language?: string;
  processingTime?: number;
  workerInfo?: WorkerInfo;
}
```

## System Models

### SystemHealth
Overall system health status.
```typescript
interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  services: ServiceHealth[];
  metrics: SystemMetrics;
}
```

### ServiceHealth
Health status of individual components (Queue, File Watcher).
```typescript
interface ServiceHealth {
  name: string;
  status: 'up' | 'down' | 'degraded';
  lastCheck: string;
  responseTime?: number;
  error?: string;
  metadata?: Record<string, any>;
}
```

### AppConfig
Application configuration structure.
- `env`: Environment (development/production)
- `port`: Server port
- `redis`: Redis connection settings
- `whisper`: Whisper.cpp settings (model, binary path)
- `processing`: File processing rules (directories, limits)
- `api`: API settings (CORS, rate limits)
- `monitoring`: Monitoring settings (Prometheus)

## Validation Schemas (Zod)

### JobCreateSchema
Validates `POST /jobs` body.
- `filePath`: string (required)
- `priority`: JobPriority (optional)
- `metadata`: object (optional)

### PaginationSchema
Validates list endpoints.
- `page`: number (min 1, default 1)
- `limit`: number (min 1, max 100, default 20)
