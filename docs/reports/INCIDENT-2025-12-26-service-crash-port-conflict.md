# Incident Report: Service Crash Loop - Port Conflict & Stale Job Queue

**Date:** 2025-12-26  
**Severity:** 🔴 **CRITICAL**  
**Status:** 🔍 **INVESTIGATING**  
**Reported By:** User (nbost130)

---

## Executive Summary

The Transcription Palantir service on production (Mithrandir) is in a **crash loop** due to a port conflict. A rogue process (PID 1573680) started outside of systemd control is holding port 9003, preventing the systemd-managed service from starting. Additionally, there are **20 failed jobs** in the queue attempting to process files that have already been successfully transcribed and moved to the completed directory.

---

## Critical Issues Identified

### 1. 🚨 **Port Conflict - Service Cannot Start**

**Problem:**
- Systemd service has attempted to restart **485+ times** (restart counter at 485)
- Each restart fails immediately with `EADDRINUSE` error on port 9003
- Service has been in crash loop since approximately 16:42 EST (over 1 hour)

**Root Cause:**
- Rogue bun process (PID 1573680) running outside systemd control
- Process started at 16:42 EST, running for 1 hour 14 minutes
- Process is holding port 9003, blocking systemd service

**Evidence:**
```bash
# Rogue process details
PID: 1573680
PPID: 1 (orphaned/detached process)
CMD: /home/nbost/.bun/bin/bun run /home/nbost/transcription-palantir/dist/index.js
ELAPSED: 01:14:54
USER: nbost

# Port ownership
lsof -i :9003
COMMAND     PID  USER FD   TYPE  DEVICE SIZE/OFF NODE NAME
bun     1573680 nbost 16u  IPv4 8975697      0t0  TCP *:9003 (LISTEN)

# Systemd restart attempts
Dec 26 17:57:01 - restart counter is at 485
Status: activating (auto-restart) (Result: exit-code)
Error: Failed to start server. Is port 9003 in use?
```

---

### 2. ❌ **Stale Job Queue - 20 Failed Jobs**

**Problem:**
- 20 jobs marked as "failed" in Redis queue
- All failures due to "Input file not accessible"
- Files were already successfully processed and moved to `/mnt/data/whisper-batch/completed/`
- Jobs are duplicate/stale entries attempting to re-process completed files

**Affected Files (7 unique files, multiple duplicate jobs):**

| File Name | Failed Jobs | Status |
|-----------|-------------|--------|
| `08 Masterclass QA Session with Leif and Paul.m4a` | 7 | ✅ Already completed |
| `07 Live Coaching 3 - Special Guest Scott and Lacey Thompson.m4a` | 3 | ✅ Already completed |
| `07 Live Coaching 3 - Special Guest Christopher Olson.m4a` | 3 | ✅ Already completed |
| `04 Interview - Baptism of Love.m4a` | 3 | ✅ Already completed |
| `06 Live Coaching 2 - Special Guest Christopher Olson.m4a` | 2 | ✅ Already completed |
| `05 Live Coaching 1- Special Guest Aaron Simmons.m4a` | 2 | ✅ Already completed |

**Root Cause:**
- Files were successfully transcribed earlier (around 14:39 EST)
- Files moved to completed directory as expected
- Duplicate jobs were created (possibly during service restarts or file watcher re-scans)
- Stale jobs remained in queue attempting to process files at original paths
- Original file paths no longer exist (files in `/completed/` directory)

**Evidence:**
```bash
# Successful completion earlier today
jobId: 07166701-449c-4497-8d5a-a514764e4239
fileName: 08 Masterclass QA Session with Leif and Paul.m4a
status: completed
completedAt: 2025-12-26T14:39:34.463Z

# File now in completed directory
/mnt/data/whisper-batch/completed/Kingdom Life Blueprint/Chapter 3 The Garden of Delight/08 Masterclass...

# Failed job attempting to access original path
error: "Input file not accessible: /mnt/data/whisper-batch/inbox/Kingdom Life Blueprint/..."
```

---

## Impact Assessment

### Service Availability
- ❌ **Production service DOWN** for 1+ hours
- ❌ **No new transcriptions** being processed
- ❌ **API unavailable** (port 9003 blocked)
- ⚠️ **Systemd consuming resources** with continuous restart attempts

### Data Integrity
- ✅ **No data loss** - All files successfully transcribed before crash
- ✅ **Transcripts intact** - Output files exist in correct locations
- ⚠️ **Queue pollution** - 20 stale/failed jobs cluttering queue
- ⚠️ **218 Redis keys** - Potential queue bloat

### User Impact
- 🔴 **HIGH** - Service completely unavailable
- 🔴 **HIGH** - Cannot process new audio files
- 🟡 **MEDIUM** - Monitoring/dashboard unavailable

---

## Timeline

| Time (EST) | Event |
|------------|-------|
| ~14:39 | Files successfully transcribed and moved to completed directory |
| ~16:42 | Rogue bun process started (PID 1573680) |
| 16:42+ | Systemd service begins crash loop (port conflict) |
| 17:55-17:57 | Restart counter reaches 476-485+ attempts |
| 22:54-22:56 | Service logs show continuous EADDRINUSE errors |
| 22:56 | Incident investigation begins |

---

## Immediate Actions Required

### 1. Kill Rogue Process
```bash
ssh mithrandir "kill -9 1573680"
```

### 2. Restart Systemd Service
```bash
ssh mithrandir "systemctl --user restart transcription-palantir"
ssh mithrandir "systemctl --user status transcription-palantir"
```

### 3. Clean Failed Jobs from Queue
```bash
# Via API (once service is running)
ssh mithrandir "curl -X DELETE 'http://localhost:9003/api/v1/jobs/failed'"

# Or via Redis CLI
ssh mithrandir "redis-cli -n 0 KEYS 'bull:transcription:*:failed' | xargs redis-cli -n 0 DEL"
```

### 4. Verify Service Health
```bash
ssh mithrandir "curl -s 'http://localhost:9003/api/v1/health' | jq"
ssh mithrandir "curl -s 'http://localhost:9003/api/v1/jobs?limit=5' | jq"
```

---

## Root Cause Analysis

### Why Did Rogue Process Start?
**Hypothesis:** Manual intervention or deployment script ran service outside systemd

**Possible Causes:**
1. Manual `bun run dist/index.js` executed directly (not via systemd)
2. Deployment script started service before systemd could manage it
3. Testing/debugging session left process running
4. Service started in background (`nohup`, `&`, etc.) bypassing systemd

### Why Duplicate Jobs?
**Hypothesis:** File watcher re-scanned directories during service restarts

**Possible Causes:**
1. Service restarted multiple times (485+ attempts)
2. File watcher's `ignoreInitial: false` re-scans on each startup
3. `processedFiles` Set cleared on each restart (in-memory state lost)
4. No persistent tracking of processed files across restarts
5. Files still in inbox during initial scans, then moved after processing

---

## Prevention Measures

### 1. Process Management
- [ ] **Document proper service management** - Only use systemd commands
- [ ] **Add process detection** - Check for existing process before starting
- [ ] **Improve deployment script** - Ensure clean shutdown before restart
- [ ] **Add port conflict detection** - Fail gracefully with clear error message

### 2. Job Queue Management
- [ ] **Implement job deduplication** - Prevent duplicate jobs for same file
- [ ] **Add persistent processed file tracking** - Redis-backed Set instead of in-memory
- [ ] **Improve file validation** - Check if file already processed before queueing
- [ ] **Add job cleanup** - Automatically remove stale failed jobs after N days
- [ ] **Implement idempotency** - Jobs should be safe to retry/duplicate

### 3. Monitoring & Alerting
- [ ] **Add service health monitoring** - Alert on crash loops
- [ ] **Add port conflict detection** - Alert when port already in use
- [ ] **Add failed job threshold alerts** - Alert when failed jobs exceed threshold
- [ ] **Add systemd restart counter monitoring** - Alert on excessive restarts

---

## Related Documentation
- Service Management: `docs/PRODUCTION_GUIDELINES.md`
- Deployment Process: `docs/DEPLOYMENT.md`
- Queue Management: `src/services/queue.ts`
- File Watcher: `src/services/file-watcher.ts`

---

## Next Steps
1. Execute immediate actions to restore service
2. Investigate how rogue process was started
3. Implement prevention measures
4. Create GitHub issue for tracking
5. Update runbooks with incident learnings

