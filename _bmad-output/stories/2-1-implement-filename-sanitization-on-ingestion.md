# Story 2.1: Implement Filename Sanitization on Ingestion

**Epic:** Epic 2: Reliable Job Processing
**Status:** ready-for-dev

As a **system administrator**,
I want the system to automatically sanitize filenames of incoming audio files,
So that special characters or spaces do not cause processing errors in the transcription pipeline.

**Acceptance Criteria:**

**Given** a file with special characters (e.g., `my audio file @#$.mp3`) is dropped into the watch directory
**When** the `FileWatcher` detects the file
**Then** it should rename the file to a safe version (e.g., `my_audio_file____.mp3` or `my-audio-file.mp3`)
**And** process the renamed file
**And** log the renaming action

**Given** a file with a safe name
**When** the `FileWatcher` detects it
**Then** it should process it without renaming

**Sanitization Rules:**
- Replace spaces with underscores or hyphens.
- Remove or replace non-alphanumeric characters (except `.` and `-` and `_`).
- Ensure the extension is preserved.
