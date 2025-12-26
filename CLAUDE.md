# Transcription Palantir - AI Assistant Guide

This file contains project-specific instructions for AI assistants working on the Transcription Palantir project.

## Project Overview

Transcription Palantir is a modern TypeScript transcription service using:
- **BullMQ** for job queue management
- **Redis** for state management
- **Faster-Whisper** (Python) for AI transcription
- **Fastify** for REST API
- **Systemd** for production service management

## Development Workflow

### Local Development
- **Location:** `/Users/nbost/dev/transcription-palantir`
- **Environment:** Development (`.env`)
- **Run:** `bun run dev` (watch mode)
- **Build:** `bun run build` (compiles TypeScript to `dist/`)

### Production Deployment
- **Location:** `mithrandir:~/transcription-palantir`
- **Environment:** Production (`.env` on server, NOT `.env.production` from repo)
- **Service:** `systemd` user service (`transcription-palantir.service`)

### Deployment Process

**CRITICAL: NEVER make changes directly on production server!**

1. **Make changes in local dev environment** (`/Users/nbost/dev/transcription-palantir`)
2. **Test locally** if possible
3. **Commit to git** with descriptive commit message
4. **Deploy using deployment script:**
   ```bash
   cd dev/transcription-palantir
   bash scripts/deploy-to-mithrandir.sh
   ```
5. **Restart service with systemd:**
   ```bash
   ssh mithrandir "systemctl --user restart transcription-palantir"
   ```
6. **Verify deployment:**
   ```bash
   ssh mithrandir "systemctl --user status transcription-palantir"
   ssh mithrandir "tail -f ~/transcription-palantir/logs/service.log"
   ```

**Note:** The deployment script:
- Backs up the remote `.env` file
- Syncs code (excluding `.env`, `node_modules`, logs)
- Builds on remote server
- Restores the original `.env`
- Does NOT restart the service (use systemd manually)

## Incident Documentation Process

When documenting incidents, bugs, or production issues:

### 1. Create Incident Report

Create a markdown file in `docs/reports/`:
```bash
docs/reports/INCIDENT-YYYY-MM-DD-brief-description.md
```

**Format:**
```markdown
# Incident Report: Brief Title

**Date:** YYYY-MM-DD
**Severity:** Low/Medium/High/Critical
**Status:** ✅ RESOLVED / 🔄 IN PROGRESS / 🔍 INVESTIGATING
**GitHub Issue:** [#N](https://github.com/nbost130/transcription-palantir/issues/N)

## Summary
Brief description of what happened

## Root Cause
Technical explanation of why it happened

## Impact
What was affected and how

## Timeline
- HH:MM - Event 1
- HH:MM - Event 2

## Resolution
Steps taken to fix the issue

## Prevention
How to prevent this in the future
```

### 2. Create GitHub Issue

```bash
# Create issue with labels
gh issue create \
  --title "[INCIDENT] Brief description" \
  --body "See docs/reports/INCIDENT-YYYY-MM-DD-*.md" \
  --label "incident,production,bug"
```

Or use the GitHub API to create the issue programmatically.

### 3. Cross-Reference

- Add GitHub issue link to incident report header
- Reference incident report in GitHub issue body

### 4. Close When Resolved

If incident is already resolved:
```bash
gh issue close N --reason completed
```

Or update the issue status via API/web interface.

## Configuration Management

### Environment Files

- **`.env`** - Local development config (gitignored)
- **`.env.production`** - Production config TEMPLATE (gitignored, for reference only)
- **`.env.example`** - Example config (committed to git)

**CRITICAL:** Production `.env` lives on Mithrandir at `~/transcription-palantir/.env` and is NEVER overwritten by deployment script.

### Key Configuration Values

**Production Whisper Configuration:**
```bash
WHISPER_BINARY_PATH=/home/nbost/faster-whisper-env/bin/python3
WHISPER_PYTHON_PATH=/home/nbost/faster-whisper-env/bin/python3
WHISPER_USE_PYTHON=true
```

**❌ NEVER use `/tmp/` for production paths!**

## Common Tasks

### Check Production Status
```bash
ssh mithrandir "systemctl --user status transcription-palantir"
```

### View Production Logs
```bash
ssh mithrandir "tail -f ~/transcription-palantir/logs/service.log"
```

### Check Queue Status
```bash
ssh mithrandir "curl -s 'http://localhost:9003/api/v1/jobs?limit=10' | jq"
```

### Restart Production Service
```bash
ssh mithrandir "systemctl --user restart transcription-palantir"
```

## Important Notes

1. **Never edit production code directly** - Always deploy from dev
2. **Never commit `.env` files** - They contain sensitive data
3. **Always preserve directory structure** - Critical for teaching series organization
4. **Check logs after deployment** - Verify no "simulation mode" warnings
5. **Use systemd for service management** - Don't use `pkill` or `nohup`

## Related Documentation

- `docs/DEVELOPMENT_WORKFLOW.md` - Detailed development process
- `docs/PRODUCTION_GUIDELINES.md` - Production deployment rules
- `docs/reports/` - Incident reports and post-mortems

