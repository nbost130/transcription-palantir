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

#### Automated Deployment (Preferred Method)

The project uses **GitHub Actions** for automated deployment:

1. **Make changes in local dev environment** (`/Users/nbost/dev/transcription-palantir`)
2. **Test locally** if possible
3. **Commit to git** with descriptive commit message
4. **Push to main branch:**
   ```bash
   git push origin main
   ```
5. **GitHub Actions automatically:**
   - Connects to Tailnet via Tailscale OAuth
   - SSHs to production server (100.77.230.53)
   - Pulls latest code
   - Installs dependencies
   - Builds TypeScript
   - Restarts service
   - Verifies health
6. **Monitor deployment:**
   - GitHub Actions: https://github.com/nbost130/transcription-palantir/actions
   - Production health: `curl http://100.77.230.53:9003/api/v1/health`

**Smart Deployment Triggers:**
- ✅ Code changes (`.ts`, `.js`, `package.json`) → Deploys automatically
- ❌ Documentation changes (`.md`, `docs/`) → Skips deployment (CI still runs)
- ❌ Config files (`.gitignore`, `LICENSE`) → Skips deployment

#### Manual Deployment (Fallback)

If automated deployment fails or you need manual control:

```bash
cd dev/transcription-palantir
bash scripts/deploy-to-mithrandir.sh
ssh mithrandir "systemctl --user restart transcription-palantir"
```

**Note:** The manual deployment script:
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

## CI/CD Pipeline

### GitHub Actions Workflows

1. **🔮 Transcription Palantir CI** (`.github/workflows/ci.yml`)
   - Runs on: Every push to any branch
   - Purpose: Tests, linting, type checking
   - Does NOT deploy

2. **🚀 Deploy to Production** (`.github/workflows/deploy.yml`)
   - Runs on: Push to `main` (excluding docs-only changes)
   - Purpose: Automated deployment to production
   - Requires: Tailscale OAuth + SSH key secrets

### Required GitHub Secrets

- `TAILSCALE_OAUTH_CLIENT_ID` - Tailscale OAuth client ID (scope: `auth_keys` write)
- `TAILSCALE_OAUTH_SECRET` - Tailscale OAuth client secret
- `MITHRANDIR_SSH_KEY` - SSH private key for production server access

See `docs/CICD_SETUP.md` for detailed setup instructions.

### Deployment Workflow Details

**Trigger Conditions:**
```yaml
on:
  push:
    branches: [ main ]
    paths-ignore:
      - '**.md'        # All markdown files
      - 'docs/**'      # Documentation directory
      - 'LICENSE'      # License file
      - '.gitignore'   # Git ignore file
```

**Deployment Steps:**
1. Checkout code from GitHub
2. Connect to Tailnet (using Tailscale GitHub Action)
3. Setup SSH authentication
4. Add SSH known hosts
5. Deploy to production:
   - `git pull origin main`
   - `npm install`
   - `npm run build`
   - `sudo systemctl restart transcription-palantir`
6. Verify deployment (health check)
7. Post deployment summary

**Access Method:**
- Uses Tailscale VPN to securely reach production server
- SSH only accessible via Tailscale IP (100.77.230.53)
- No public SSH exposure

## Known Issues

### Progress Reporting (Issue #9)

**Problem:** Job progress shows misleading "30%" placeholder instead of actual transcription progress.

**Symptoms:**
- Jobs show `progress: 30` immediately when they start processing
- Progress value remains at 30% throughout entire transcription (even for multi-hour jobs)
- Log entries show empty progress field: `"progress":""`
- Creates confusion about actual job completion status

**Workaround:**
- Ignore the progress percentage - it's just a status indicator meaning "processing"
- Use job `startedAt` timestamp and file size to estimate completion time
- Monitor service logs for actual completion events
- Large files (60-120MB) typically take 2-4 hours to transcribe

**Tracking:** https://github.com/nbost130/transcription-palantir/issues/9

## Related Documentation

- `docs/CICD_SETUP.md` - CI/CD configuration and secrets setup
- `docs/DEVELOPMENT_WORKFLOW.md` - Detailed development process
- `docs/PRODUCTION_GUIDELINES.md` - Production deployment rules
- `docs/reports/` - Incident reports and post-mortems
- `.github/workflows/` - GitHub Actions workflow definitions

