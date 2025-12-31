# API Contracts

## Overview
Base URL: `/api/v1` (configurable via `API_PREFIX`)

## Health & System

### `GET /health`
Basic liveness check.
- **Response**: 200 OK
  ```json
  {
    "status": "ok",
    "timestamp": "2023-10-27T10:00:00.000Z",
    "uptime": 123.45
  }
  ```

### `GET /ready`
Readiness check with service status.
- **Response**: 200 OK (if all ready), 503 Service Unavailable
  ```json
  {
    "status": "ready",
    "services": [
      { "name": "queue", "status": "up", "lastCheck": "..." },
      { "name": "file_watcher", "status": "up", "lastCheck": "..." }
    ],
    "timestamp": "..."
  }
  ```

### `GET /health/detailed`
Detailed system health with metrics.
- **Response**: 200 OK
  ```json
  {
    "status": "healthy",
    "metrics": {
      "jobs": { "total": 100, "pending": 5, ... },
      "workers": { "active": 2, ... },
      "system": { "cpuUsage": 0.5, "memoryUsage": 128, ... }
    },
    ...
  }
  ```

### `GET /system/info`
Get comprehensive system information including Whisper.cpp status.
- **Response**: 200 OK
  ```json
  {
    "success": true,
    "data": {
      "environment": "production",
      "version": "1.0.0",
      "whisper": { "binaryExists": true, "currentModel": "small", ... },
      "config": { ... }
    }
  }
  ```

## Jobs

### `POST /jobs`
Create a new transcription job.
- **Body**:
  ```json
  {
    "filePath": "/path/to/audio.mp3",
    "priority": 3, // Optional (1=URGENT, 2=HIGH, 3=NORMAL, 4=LOW)
    "metadata": { "language": "en" } // Optional
  }
  ```
- **Response**: 201 Created
  ```json
  {
    "success": true,
    "data": { "jobId": "uuid", "status": "pending", ... }
  }
  ```

### `GET /jobs`
Get all jobs with pagination.
- **Query Params**: `page` (default 1), `limit` (default 20), `status` (optional filter)
- **Response**: 200 OK
  ```json
  {
    "success": true,
    "data": [ ... ],
    "pagination": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 }
  }
  ```

### `GET /jobs/:jobId`
Get a specific job by ID.
- **Response**: 200 OK
  ```json
  {
    "success": true,
    "data": { "jobId": "...", "status": "completed", "progress": 100, ... }
  }
  ```

### `PATCH /jobs/:jobId`
Update job priority or metadata.
- **Body**:
  ```json
  {
    "priority": 2,
    "metadata": { "customField": "value" }
  }
  ```
- **Response**: 200 OK

### `DELETE /jobs/:jobId`
Delete a job.
- **Response**: 200 OK

### `POST /jobs/:jobId/retry`
Retry a failed job.
- **Response**: 200 OK

## Monitoring & Metrics

### `GET /metrics`
Prometheus metrics in text format.

### `GET /monitor/queue`
Get queue dashboard data (recent jobs, throughput).
- **Response**: 200 OK

### `GET /monitor/workers`
Get worker status and utilization.
- **Response**: 200 OK

### `GET /monitor/status`
Get overall system status summary.
- **Response**: 200 OK

### `GET /monitor/timeline`
Get job processing timeline.
- **Query Params**: `hours` (default 1)
- **Response**: 200 OK

## WebSocket

### `/ws/queue`
Real-time queue statistics updates.

### `/ws/jobs/:jobId`
Real-time progress updates for a specific job.

### `/ws/events`
System-wide events (health, alerts).
