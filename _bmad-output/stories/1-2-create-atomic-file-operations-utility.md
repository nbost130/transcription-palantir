# Story 1.2: Create Atomic File Operations Utility

**Epic:** Epic 1: Self-Healing Boot & Recovery
**Status:** ready-for-dev

As a **developer**,
I want an `atomicMove()` utility that handles cross-filesystem moves,
So that file operations are atomic even when source and destination are on different filesystems.

**Acceptance Criteria:**

**Given** I need to move files atomically
**When** I call `atomicMove(src, dest)` where both paths are on the same filesystem
**Then** it must use `fs.rename()` for a fast atomic operation
**And** it must succeed without creating temporary files

**Given** I need to move files across different filesystems
**When** I call `atomicMove(src, dest)` and `fs.rename()` fails with `EXDEV` error
**Then** it must copy the file to `${dest}.tmp` on the destination filesystem
**And** it must rename `${dest}.tmp` to `dest` (atomic on same FS)
**And** it must delete the source file
**And** if the process crashes during copy, the `.tmp` file must be safely ignored/cleaned

**Given** the move operation fails
**When** any error occurs (other than `EXDEV`)
**Then** it must throw the error with context about source and destination paths
