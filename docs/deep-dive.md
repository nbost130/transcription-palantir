# Deep Dive: Transcription System Internals

## 1. Queue Management
The system uses **BullMQ** backed by **Redis** to manage transcription jobs. The core logic is encapsulated in `TranscriptionQueueService` (`src/services/queue.ts`).

### Key Components
- **Queue Name**: `transcription-queue`
- **Job Data Structure**:
  ```typescript
  interface TranscriptionJobData {
    filePath: string;
    fileName: string;
    // ... options
  }
  ```

### Job Lifecycle
1.  **Added**: Jobs are added via `addJob`.
2.  **Waiting**: Jobs wait in Redis until a worker is free.
3.  **Active**: Worker picks up the job.
4.  **Completed/Failed**: Final states.

## 2. Worker Implementation
The worker (`src/workers/transcription-worker.ts`) is a separate process that consumes jobs from the queue.

### Processing Flow
1.  **Job Pick-up**: BullMQ worker retrieves a job.
2.  **Validation**: Checks if file exists.
3.  **Transcription**: Calls `WhisperService` to perform the actual transcription.
4.  **Output**: Saves `.txt`, `.vtt`, `.srt`, `.json` files to the output directory.
5.  **Completion**: Marks job as completed in Redis.

## 3. API & Job Control
The API (`src/api/routes/jobs.ts`) provides control over the queue.

### Retry Logic
The retry mechanism (`POST /jobs/:jobId/retry`) is sophisticated:
- It checks if the job is actually failed.
- **File Recovery**: If the input file was moved to the `failed` directory (a common pattern in file-watching systems), the API attempts to move it back to the processing directory before retrying the job.

### Job Listing
`GET /jobs` aggregates jobs from all states (waiting, active, completed, failed) to provide a unified view for the dashboard.

## 4. File Watcher
`FileWatcherService` (`src/services/file-watcher.ts`) monitors the input directory.
- On `add` event: Creates a new job in the queue.
- Debouncing is used to ensure files are fully written before processing.
