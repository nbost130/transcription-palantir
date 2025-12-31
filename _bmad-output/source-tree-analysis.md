# Source Tree Analysis

## Directory Structure

### `src/`
Root source directory.
- `index.ts`: Application entry point.

### `src/api/`
Fastify API implementation.
- `server.ts`: Server setup and configuration.
- `routes/`: API route definitions.
  - `health.ts`: Health checks.
  - `jobs.ts`: Job management (CRUD).
  - `metrics.ts`: Prometheus metrics.
  - `monitor.ts`: Dashboard monitoring data.
  - `system.ts`: System info and config.
  - `websocket.ts`: Real-time updates.
- `middleware/`: Custom middleware (auth, logging).

### `src/services/`
Core business logic.
- `queue.ts`: BullMQ wrapper for job management.
- `file-watcher.ts`: Chokidar-based file monitoring.
- `whisper.ts`: Wrapper for `whisper.cpp` CLI.
- `file-tracker.ts`: Redis-backed file deduplication.
- `process-guard.ts`: Process management.

### `src/config/`
Configuration management.
- `index.ts`: Zod-validated configuration loader.

### `src/types/`
TypeScript type definitions.
- `index.ts`: Shared types (Job, API, Config).

### `src/utils/`
Utility functions.
- `logger.ts`: Pino logger configuration.
- `file.ts`: File handling helpers.

### `src/workers/`
Background workers.
- `transcription-worker.ts`: Worker process that consumes the queue and calls Whisper service.

## Key Components

1.  **API Server (`src/api/server.ts`)**: Fastify instance handling HTTP and WebSocket requests.
2.  **Queue Service (`src/services/queue.ts`)**: Manages the BullMQ queue 'transcription', handling job addition, priority, and status.
3.  **File Watcher (`src/services/file-watcher.ts`)**: Watches `audio_input` directory for new files, validates them, and adds them to the queue.
4.  **Whisper Service (`src/services/whisper.ts`)**: Executes the `whisper.cpp` binary to transcribe audio files.
5.  **File Tracker (`src/services/file-tracker.ts`)**: Prevents duplicate processing by tracking file hashes in Redis.

## Deployment

### Docker
- `Dockerfile`: Multi-stage build for API, Worker, and Watcher services.
- `docker-compose.yml`: Orchestrates Redis, API, Worker, Watcher, Prometheus, and Grafana.

### Infrastructure
- **Redis**: Primary data store for BullMQ and File Tracker.
- **Prometheus/Grafana**: Monitoring stack.
