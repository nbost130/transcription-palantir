# 🚨 EMERGENCY RECOVERY INSTRUCTIONS
**Date:** 2025-12-26  
**Issue:** Service crash loop + stale failed jobs

---

## TL;DR - Quick Fix

```bash
# SSH to production
ssh mithrandir

# Run recovery script
cd ~/transcription-palantir
bash scripts/fix-service-crash-2025-12-26.sh
```

The script will:
1. Kill rogue process holding port 9003
2. Restart systemd service
3. Verify service health
4. Optionally clean stale failed jobs

---

## What Happened?

### The Good News 🎉
**All 7 files were successfully transcribed!** The "errors" are just stale jobs trying to re-process files that are already done.

### The Bad News 😱
**Service has been DOWN for 6+ hours** due to a rogue process blocking port 9003.

---

## The "7 Files" Status

| File | Status | Location |
|------|--------|----------|
| 08 Masterclass QA Session... | ✅ Completed | `/completed/Kingdom Life Blueprint/...` |
| 07 Live Coaching 3 - Scott... | ✅ Completed | `/completed/Kingdom Life Blueprint/...` |
| 07 Live Coaching 3 - Christopher... | ✅ Completed | `/completed/Kingdom Life Blueprint/...` |
| 04 Interview - Baptism of Love | ✅ Completed | `/completed/Kingdom Life Blueprint/...` |
| 06 Live Coaching 2 - Christopher... | ✅ Completed | `/completed/Kingdom Life Blueprint/...` |
| 05 Live Coaching 1 - Aaron... | ✅ Completed | `/completed/Kingdom Life Blueprint/...` |

**All transcripts exist and are valid!**

---

## Manual Recovery (If Script Fails)

### Step 1: Kill Rogue Process
```bash
ssh mithrandir
lsof -ti :9003  # Get PID
kill -9 <PID>   # Replace <PID> with actual number
```

### Step 2: Restart Service
```bash
systemctl --user stop transcription-palantir
systemctl --user start transcription-palantir
systemctl --user status transcription-palantir
```

### Step 3: Verify Health
```bash
curl http://localhost:9003/api/v1/health | jq
curl http://localhost:9003/api/v1/jobs?limit=5 | jq
```

### Step 4: Clean Failed Jobs (Optional)
```bash
# Get failed job IDs
curl -s 'http://localhost:9003/api/v1/jobs?status=failed' | jq -r '.data[].jobId'

# Delete each one
curl -X DELETE "http://localhost:9003/api/v1/jobs/<JOB_ID>"
```

---

## Root Causes

1. **Rogue Process:** Someone/something started the service outside systemd
2. **Duplicate Jobs:** File watcher re-scans on every restart (485+ times!)
3. **No Safeguards:** No detection for port conflicts or duplicate jobs

---

## Prevention

### Immediate
- [ ] Only use systemd to manage service
- [ ] Never run `bun run dist/index.js` directly
- [ ] Always use `systemctl --user restart transcription-palantir`

### Short-term
- [ ] Add process detection before starting
- [ ] Implement job deduplication
- [ ] Add persistent tracking of processed files
- [ ] Add monitoring/alerting

---

## Documentation

Full details in:
- `docs/reports/INCIDENT-2025-12-26-service-crash-port-conflict.md`
- `docs/reports/DEEP-DIVE-2025-12-26-palantir-investigation.md`

---

## Questions?

Check the incident reports or ask Kai for clarification.

**Remember:** The files are fine! Just need to clean up the service and queue.

