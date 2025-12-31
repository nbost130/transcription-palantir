# Story 2.2: Implement Duplicate File Prevention

**Epic:** Epic 2: Reliable Job Processing
**Status:** ready-for-dev

As a **system administrator**,
I want the system to prevent creating duplicate transcription jobs for the same file,
So that resources are not wasted re-processing content that is already in the queue or completed.

**Acceptance Criteria:**

**Given** a file is detected by the `FileWatcher`
**When** the system attempts to create a job for it
**Then** it should check if a job with the same `fileName` (and ideally `fileHash` if available, but `fileName` is MVP) already exists in:
  - Active jobs
  - Waiting jobs
  - Completed jobs
  - Failed jobs (optional: maybe we want to retry failed ones, but for now prevent duplicates)

**Given** a duplicate job is found
**Then** the new job creation should be skipped
**And** a log message should indicate the duplicate was skipped

**Given** no duplicate is found
**Then** the job should be created as normal

**Technical Notes:**
- BullMQ has `getJob` but searching by custom data is hard.
- We can use `queue.getJobs(['active', 'waiting', 'completed', 'failed'])` but that's expensive.
- Better approach: Use a Redis Set or Hash to track processed files/jobs, OR rely on `jobId` being deterministic if possible (e.g. hash of filename).
- Current `FileWatcher` uses `processedFiles` Set (in-memory) and `FileTracker` (SQLite/JSON/Redis?).
- `FileTracker` seems to be the place for this persistence.
- However, `FileTracker` might only track *ingested* files. We want to check the *Queue* state too.
- Actually, making `jobId` deterministic based on filename (or hash) is the most robust way. `BullMQ` prevents adding a job with an existing ID if it's still in the queue.
- Let's try deterministic `jobId` based on filename hash.
