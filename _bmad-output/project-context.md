# Project Context: Transcription Palantir

## Overview
Transcription Palantir is a robust, event-driven transcription service built with TypeScript, Fastify, and BullMQ. It leverages `whisper.cpp` for high-performance, local audio transcription. The system is designed to be autonomous, monitoring directories for new files and processing them via a priority queue.

## Core Architecture
- **Type**: Backend Monolith (Service-Oriented)
- **Language**: TypeScript
- **Framework**: Fastify
- **Queue System**: BullMQ (Redis-backed)
- **Transcription Engine**: Whisper.cpp (CLI wrapper)

## Key Features
1.  **Automated Ingestion**: Watches directories for new audio files.
2.  **Priority Queuing**: Handles Urgent (<10MB), High, Normal, and Low (>100MB) priority jobs.
3.  **Resilience**:
    - Redis-backed job persistence.
    - Automatic retries with exponential backoff.
    - File tracking to prevent duplicate processing.
4.  **Observability**:
    - Real-time WebSocket updates for queue and job status.
    - Prometheus metrics and Grafana dashboards.
    - Detailed health checks (Liveness/Readiness).
5.  **API**: RESTful API for job management and system monitoring.

## Critical Workflows
1.  **File Ingestion**:
    - `FileWatcher` detects new file -> Validates -> Checks `FileTracker` (dedup) -> Adds to `TranscriptionQueue`.
2.  **Job Processing**:
    - `Worker` picks up job -> Spawns `WhisperService` -> Updates progress -> Saves transcript -> Marks job complete.
3.  **API Interaction**:
    - Client POSTs to `/jobs` -> Job added to queue -> ID returned.
    - Client listens to `/ws/jobs/:id` for real-time progress.

## Tech Stack
- **Runtime**: Node.js / Bun
- **API**: Fastify
- **Queue**: BullMQ, IORedis
- **Validation**: Zod
- **Logging**: Pino
- **Containerization**: Docker, Docker Compose

## Development Status
- **Phase**: Active Development / Stabilization
- **Recent Changes**:
    - Stabilized Redis connections.
    - Improved test isolation.
    - Verified integration with `mithrandir-unified-api`.
