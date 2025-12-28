#!/bin/bash
set -e

echo "Running tests sequentially..."

echo "Running Unit Tests..."
bun test src/utils/logger.test.ts
bun test src/services/file-watcher.test.ts
bun test src/workers/transcription-worker.test.ts

echo "Running Integration Tests..."
bun test tests/integration/queue.test.ts
bun test tests/integration/api.test.ts
bun test tests/integration/transcription-flow.test.ts

echo "All tests passed!"
