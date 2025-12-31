# Project Overview: transcription-palantir

**Type:** Backend Service
**Language:** TypeScript
**Framework:** Fastify, BullMQ, Redis
**Date:** 2025-12-30

## Description
Modern TypeScript transcription system with BullMQ, Redis, and Whisper.cpp integration. It handles audio file ingestion, queuing, transcription using Whisper (via `whisper.cpp` or `faster-whisper`), and exposes an API and Dashboard for monitoring.

## Key Features
- **Audio Ingestion**: Watches directories for new audio files.
- **Job Queue**: Uses BullMQ and Redis for robust job management.
- **Transcription**: Integrates with Whisper models for high-quality transcription.
- **API**: Fastify-based REST API for job status and control.
- **Dashboard**: Real-time monitoring of transcription jobs.
- **Dockerized**: Ready for containerized deployment.

## Architecture Summary
The system follows an event-driven architecture:
1.  **File Watcher**: Detects new files and adds them to the queue.
2.  **API**: Allows manual submission and status checks.
3.  **Queue (BullMQ)**: Manages transcription jobs (waiting, active, completed, failed).
4.  **Worker**: Processes jobs by running the Whisper transcription engine.
5.  **Redis**: Stores job state and queue data.

## Tech Stack
- **Runtime**: Bun / Node.js
- **Language**: TypeScript
- **Web Framework**: Fastify
- **Queue**: BullMQ
- **Database**: Redis
- **Transcription**: Whisper.cpp / Faster-Whisper
- **DevOps**: Docker, Docker Compose

## Setup & Run
```bash
# Install dependencies
bun install

# Start infrastructure (Redis)
docker-compose up -d

# Run in development mode
bun run dev

# Run tests
bun test
```
