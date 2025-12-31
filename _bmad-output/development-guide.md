# Development Guide

## Prerequisites
- Node.js >= 18
- Bun >= 1.0
- Docker & Docker Compose
- Whisper.cpp (installed locally or via Docker)

## Setup

1.  **Install Dependencies**
    ```bash
    bun install
    ```

2.  **Environment Configuration**
    Copy `.env.example` to `.env` and configure:
    ```bash
    cp .env.example .env
    ```
    Key variables:
    - `PORT`: API port (default 3000)
    - `REDIS_HOST`: Redis host (default localhost)
    - `WHISPER_BINARY_PATH`: Path to `whisper.cpp` binary
    - `WATCH_DIRECTORY`: Directory to monitor for audio files

3.  **Start Redis**
    ```bash
    docker-compose up -d redis
    ```

## Running Locally

### Development Mode
Runs the API server with hot reload:
```bash
bun run dev
```

### Start Services Individually
- **API**: `bun run start:api`
- **Worker**: `bun run start:worker`
- **Watcher**: `bun run start:watcher`

## Docker Deployment

Build and run the full stack:
```bash
docker-compose up -d --build
```
This starts:
- Redis (6379)
- API (3000)
- Worker (2 replicas)
- Watcher
- Prometheus (9090)
- Grafana (3001)

## Testing

Run unit and integration tests:
```bash
bun test
```

Run integration tests only:
```bash
bun run test:integration
```

## Architecture Notes

- **Queue**: Uses BullMQ with Redis. Jobs are persistent.
- **File Watching**: Chokidar watches for new files. Files are hashed to prevent duplicate processing.
- **Transcription**: Spawns `whisper.cpp` as a child process. Output is parsed from generated files.
