# Incident Report: Simulation Mode Fallback

**Date:** 2025-12-26
**Severity:** Medium
**Status:** ✅ RESOLVED
**GitHub Issue:** [#6](https://github.com/nbost130/transcription-palantir/issues/6)

## Summary

Production transcription service fell back to simulation mode for 9 out of 11 Kingdom Life Blueprint files that were moved to inbox for processing. Files received simulated `.txt` transcripts instead of real Whisper transcriptions.

## Root Cause

The production `dist/index.js` was compiled with an incorrect `WHISPER_BINARY_PATH` that pointed to `/tmp/whisper-env/bin/python3` instead of the correct path `/home/nbost/faster-whisper-env/bin/python3`.

### Technical Details

1. **Validation Check:** The `TranscriptionWorker.runWhisperTranscription()` method calls `whisperService.validateBinary()` to check if the Whisper binary exists and is executable (line 267 of `src/workers/transcription-worker.ts`)

2. **Wrong Path:** The compiled code was checking for `/tmp/whisper-env/bin/python3` which doesn't exist

3. **Fallback Behavior:** When `validateBinary()` returns `false`, the worker falls back to `simulateTranscription()` which creates a `.txt` file with mock content (lines 270-272)

4. **Logs Evidence:**
   ```
   {"level":"warn","time":"2025-12-26T14:39:09.191Z","path":"/tmp/whisper-env/bin/python3","msg":"Whisper.cpp binary not found or not executable"}
   {"level":"warn","time":"2025-12-26T14:39:09.191Z","msg":"Whisper.cpp not found, using simulation mode"}
   ```

## Timeline

- **Dec 25, 2025:** Directory structure fix deployed to production (commits `e930672` and `bda32d7`)
- **Dec 26, 08:16:** `.env` file updated with correct path `/home/nbost/faster-whisper-env/bin/python3`
- **Dec 26, 09:36:** Production `dist/index.js` rebuilt (likely during cleanup, with wrong config)
- **Dec 26, 09:39:** Service restarted, 11 Kingdom Life Blueprint files moved to inbox
- **Dec 26, 09:39:** 9 files received simulated transcripts, 2 files received real transcripts

## Impact

**Affected Files (9 total):**
1. Chapter 3: Masterclass QA Session with Leif and Paul
2. Chapter 3: Live Coaching 3 - Special Guest Scott and Lacey Thompson
3. Chapter 4: Interview - The Orphan Spirit
4. Chapter 4: Live Coaching 3 - Special Guest Christopher Olson
5. Chapter 5: Interview - Baptism of Love
6. Chapter 5: Live Coaching 1 - Special Guest Aaron Simmons
7. Chapter 7: Masterclass QA with Leif and Paul
8. Chapter 8: Interview - The Spirit of Adoption
9. Chapter 9: Live Coaching 2 - Special Guest Christopher Olson

**Successfully Transcribed (2 total):**
- Chapter 5: Live Coaching 3 - Special Guest Nicolas Barta (269KB JSON)
- Chapter 5: Soaking with Paul and Verge (79KB JSON)

## Resolution Plan

1. ✅ Document the issue (this file)
2. ✅ Verify dev environment has correct `.env` configuration
3. ✅ Rebuild production bundle with correct config
4. ✅ Deploy to Mithrandir
5. ✅ Restart production service
6. ✅ Move the 9 simulation files back to inbox for real transcription

## Resolution Completed

**Fixed `.env.production` in dev repo:**
```bash
# Changed from:
WHISPER_BINARY_PATH=/tmp/whisper-env/bin/python3
WHISPER_PYTHON_PATH=/tmp/whisper-env/bin/python3

# To:
WHISPER_BINARY_PATH=/home/nbost/faster-whisper-env/bin/python3
WHISPER_PYTHON_PATH=/home/nbost/faster-whisper-env/bin/python3
```

**Deployment Steps Taken:**
1. Fixed `.env.production` in dev repo (lines 25-26)
2. Rebuilt with `bun run build`
3. Deployed to Mithrandir using `scripts/deploy-to-mithrandir.sh`
4. Restarted service with `systemctl --user restart transcription-palantir`
5. Moved 9 simulation files back to inbox for real transcription
6. Deleted 2 duplicate .txt simulation files for files that already had real .json transcriptions

**Files Re-processing (9 total):**
All 9 files have been moved back to inbox and are currently being transcribed with real Whisper:
1. Chapter 3: Masterclass QA Session with Leif and Paul
2. Chapter 3: Live Coaching 3 - Special Guest Scott and Lacey Thompson
3. Chapter 4: Interview - The Orphan Spirit
4. Chapter 4: Live Coaching 3 - Special Guest Christopher Olson
5. Chapter 5: Interview - Baptism of Love
6. Chapter 5: Live Coaching 1 - Special Guest Aaron Simmons
7. Chapter 7: Masterclass QA with Leif and Paul
8. Chapter 8: Interview - The Spirit of Adoption
9. Chapter 9: Live Coaching 2 - Special Guest Christopher Olson

**Status:** ✅ RESOLVED - Service is now using correct Whisper configuration and processing files with real transcription (no more simulation mode)

## Prevention

**Immediate:**
- Always verify `.env` is loaded correctly before building for production
- Check production logs after deployment for "simulation mode" warnings

**Long-term:**
- Add startup validation that logs the actual `WHISPER_BINARY_PATH` being used
- Add health check endpoint that verifies Whisper binary is accessible
- Consider failing fast on startup if Whisper binary is not found (instead of silent fallback to simulation)
- Add build script that validates environment variables before compilation

## Notes

- Directory structure preservation is working correctly (files maintained chapter hierarchy)
- The duplicate job creation bug from before Dec 25 is resolved
- Simulation mode is intended for development/testing only, not production

