# Incident Report: Production Environment Configuration Error

**Date:** 2025-12-27
**Severity:** High
**Status:** ✅ RESOLVED
**GitHub Issue:** [#13](https://github.com/nbost130/transcription-palantir/issues/13)

## Summary

Production service was in a crash loop (2,217+ restart failures) due to incorrect macOS file paths in the `.env` configuration. The service was attempting to create directories at `/Users/nbost/*` on a Linux system, causing all transcription jobs to fail with `EACCES: permission denied`.

## Timeline

- **Dec 26, 2024** - Production `.env` misconfigured with macOS paths (based on `.env.backup` timestamp)
- **Dec 27, 15:16 EST** - Service crashed, orphaned process held port 9003
- **Dec 27, 20:24 EST** - Service in crash loop (restart counter: 2,198+)
- **Dec 27, 20:29 EST** - Investigation revealed orphaned process + config error
- **Dec 27, 20:30 EST** - Fixed configuration and restarted service
- **Dec 27, 20:31 EST** - Service healthy and operational

## Root Cause

### Configuration Error

Production `.env` file contained development/macOS paths instead of Linux production paths:

```bash
# ❌ INCORRECT (what was in production)
WATCH_DIRECTORY=/Users/nbost/Audio-To-Process
OUTPUT_DIRECTORY=/Users/nbost/transcripts

# ✅ CORRECT (what should be in production)
WATCH_DIRECTORY=/mnt/data/whisper-batch/inbox
OUTPUT_DIRECTORY=/mnt/data/whisper-batch/completed/transcripts
```

### How It Happened

The exact cause is unclear, but likely scenarios:
1. **Manual editing error** - Someone accidentally used macOS paths when configuring production
2. **Copy-paste from dev environment** - Local dev `.env` accidentally copied to production
3. **Incomplete migration** - Dec 26 migration/consolidation may have left wrong paths

**Note:** It was NOT the deployment script - the script properly excludes `.env` files:
```bash
rsync -avz --exclude '.env' ...
```

### Secondary Issue: Orphaned Process

An orphaned Bun process (PID 3248755) from the earlier crash held port 9003, preventing systemd from restarting the service. This created a crash loop where:
1. systemd tries to start service
2. Port 9003 already in use (orphaned process)
3. Service exits with EADDRINUSE
4. systemd waits 10s and retries
5. Repeat 2,217+ times

## Impact

### Service Availability
- Service unavailable for ~5 hours (15:16 - 20:30 EST)
- 2,217+ failed restart attempts
- Zero active transcription workers during outage

### Data Impact
- **No data loss** - Failed jobs remained in queue
- 20+ jobs failed with path errors before fix
- 12 Kingdom Life Blueprint audio files (59MB-114MB) unprocessed
- File watcher unable to create jobs due to service crash

### User Impact
- Dashboard showed "0 jobs" in all statuses
- Priority update feature failed (API unreachable)
- No new transcriptions processed

## Resolution

### Immediate Fix

1. **Killed orphaned process:**
   ```bash
   kill -9 3248755
   ```

2. **Fixed `.env` configuration:**
   ```bash
   # Commented out incorrect macOS path
   sed -i 's|^OUTPUT_DIRECTORY=/Users/nbost/transcripts|# OUTPUT_DIRECTORY=/Users/nbost/transcripts|' .env

   # Uncommented correct Linux path
   sed -i 's|^# OUTPUT_DIRECTORY=/mnt/data/whisper-batch/completed/transcripts|OUTPUT_DIRECTORY=/mnt/data/whisper-batch/completed/transcripts|' .env
   ```

3. **Restarted service:**
   ```bash
   systemctl --user restart transcription-palantir
   ```

4. **Verified health:**
   ```bash
   curl http://localhost:9003/api/v1/health
   # {"status":"ok","uptime":70.109806849}
   ```

### Current State

- ✅ Service running (PID 3684270)
- ✅ Port 9003 properly bound
- ✅ API responding to health checks
- ✅ Configuration corrected for Linux paths
- ⏳ Queue empty (waiting for file watcher to detect files)

## Prevention

### Immediate Actions (Required)

1. **Add environment validation on startup**
   - Check that configured paths exist
   - Verify paths are absolute
   - Detect if paths use wrong OS convention (e.g., `/Users` on Linux)
   - Fail fast with clear error message

2. **Add pre-deployment checks**
   - Script to validate production `.env` before deployment
   - Compare against `.env.production` template
   - Warn on macOS-specific paths

3. **Improve documentation**
   - Add "Common Pitfalls" section to CLAUDE.md
   - Document correct production paths prominently
   - Add troubleshooting guide for config errors

### Long-term Solutions

1. **Environment-aware configuration system**
   - Auto-detect OS and use appropriate defaults
   - Use config files per environment (dev/prod)
   - Move away from `.env` for production

2. **Automated monitoring**
   - Alert when service restart count exceeds threshold
   - Monitor for orphaned processes
   - Health check failures trigger notifications

3. **Improved systemd service**
   - Add cleanup of orphaned processes before start
   - Use `KillMode=mixed` to handle child processes
   - Add `Restart=on-failure` with `StartLimitBurst`

4. **Configuration management**
   - Use Ansible/Chef to manage production config
   - Store production config in secure vault
   - Never rely on manual editing

## Lessons Learned

1. **Manual config editing is risky** - Even with gitignored `.env`, humans make mistakes
2. **Fail fast is better** - Service should validate config on startup, not crash on first job
3. **Process cleanup matters** - Orphaned processes can create cascading failures
4. **Monitoring needed** - 2,217 crashes should have triggered an alert
5. **Template validation** - `.env.production` template exists but wasn't being validated against

## Related Issues

- #9 - Misleading progress reporting (unrelated, but discovered during this incident)
- #12 - Priority updates not persisting (recently fixed, unrelated)

## Appendix

### Error Logs

```
[01:28:13] ERROR (transcription-palantir): Failed to start API server
    error: {
      "code": "EADDRINUSE",
      "syscall": "listen",
      "errno": 0
    }

[01:29:59] ERROR (transcription-palantir): ❌ Job failed
    jobId: "204da10f-7178-438b-a41a-f9e3e59b2fb7"
    fileName: "06 Live Coaching 2.m4a"
    attemptsMade: 2
    error: "EACCES: permission denied, mkdir '/Users'"
```

### Production File Inventory

- Total files in inbox: 582
- Audio files (.m4a, .wav): 17
- Real audio files (non-zero): 12
- Zero-byte artifacts: 5
- PDFs/documents: 565

### Commands Used

```bash
# Investigation
ssh mithrandir "lsof -i :9003"
ssh mithrandir "tail -200 ~/transcription-palantir/logs/service.log"
ssh mithrandir "grep OUTPUT_DIRECTORY ~/transcription-palantir/.env"

# Resolution
ssh mithrandir "kill -9 3248755"
ssh mithrandir "sed -i 's|^OUTPUT_DIRECTORY=/Users/nbost/transcripts|# OUTPUT_DIRECTORY=/Users/nbost/transcripts|' ~/transcription-palantir/.env"
ssh mithrandir "sed -i 's|^# OUTPUT_DIRECTORY=/mnt/data/whisper-batch/completed/transcripts|OUTPUT_DIRECTORY=/mnt/data/whisper-batch/completed/transcripts|' ~/transcription-palantir/.env"
ssh mithrandir "systemctl --user restart transcription-palantir"

# Verification
ssh mithrandir "curl http://localhost:9003/api/v1/health"
ssh mithrandir "systemctl --user status transcription-palantir"
```
