# Deployment Guide

## Quick Reference

### Automated Deployment (Default)

Simply push to `main`:

```bash
git add .
git commit -m "feat: Add new feature"
git push origin main
```

GitHub Actions will automatically:
1. ✅ Run tests (CI workflow)
2. ✅ Deploy to production (if code changed)
3. ✅ Restart service
4. ✅ Verify health

**Monitor:** https://github.com/nbost130/transcription-palantir/actions

### What Triggers Deployment?

| Change Type | Deploys? |
|-------------|----------|
| `.ts`, `.js` files | ✅ Yes |
| `package.json` | ✅ Yes |
| `.github/workflows/` | ✅ Yes |
| `.md` files | ❌ No (CI only) |
| `docs/` directory | ❌ No (CI only) |
| `.gitignore`, `LICENSE` | ❌ No (CI only) |

### Manual Deployment (Fallback)

If automated deployment fails:

```bash
cd ~/dev/transcription-palantir
bash scripts/deploy-to-mithrandir.sh
ssh mithrandir "systemctl --user restart transcription-palantir"
```

## Pre-Deployment Checklist

1. **Validate environment files** – Run `bun run check:env -- --env-file ~/transcription-palantir/.env --platform linux` (or point to the remote path) and ensure it matches `.env.production`. The script fails fast if directories drift or macOS paths sneak into the Linux host.
2. **Confirm mounts** – Double check `/mnt/data/whisper-batch` is mounted and contains `inbox`, `completed/transcripts`, and `failed` folders. The service will now refuse to start if the mount is missing.
3. **Commit template changes** – If production paths legitimately change, update `.env.production`, rerun the check, and include the doc changes in the deploy PR.

## Verification

### Check Deployment Status

```bash
# GitHub Actions
open https://github.com/nbost130/transcription-palantir/actions

# Production health
curl http://100.77.230.53:9003/api/v1/health

# Service status
ssh mithrandir "systemctl --user status transcription-palantir"

# Recent logs
ssh mithrandir "journalctl --user -u transcription-palantir -n 50 --no-pager"
```

### Verify Specific Deployment

```bash
# Check deployed commit
ssh mithrandir "cd ~/transcription-palantir && git log -1 --oneline"

# Check service uptime
curl -s http://100.77.230.53:9003/api/v1/health | jq '.uptime'

# Check all services
curl -s http://100.77.230.53:9003/api/services/health | jq '.data.summary'
```

## Rollback

If deployment causes issues:

```bash
# SSH to production
ssh mithrandir

# Navigate to project
cd ~/transcription-palantir

# Check current commit
git log -1

# Rollback to previous commit
git reset --hard HEAD~1

# Or rollback to specific commit
git reset --hard <commit-sha>

# Rebuild and restart
npm install
npm run build
systemctl --user restart transcription-palantir

# Verify
curl http://localhost:9003/api/v1/health
```

Then fix the issue locally and push the fix.

## Troubleshooting

### Deployment Failed

1. Check GitHub Actions logs: https://github.com/nbost130/transcription-palantir/actions
2. Look for failed step (Tailscale, SSH, build, restart, health check)
3. Check production logs: `ssh mithrandir "journalctl --user -u transcription-palantir -n 100"`

### Service Won't Start

```bash
# Check service status
ssh mithrandir "systemctl --user status transcription-palantir"

# Check logs
ssh mithrandir "journalctl --user -u transcription-palantir -n 100 --no-pager"

# Check for port conflicts
ssh mithrandir "lsof -i :9003"

# Verify environment
ssh mithrandir "cd ~/transcription-palantir && cat .env | grep -v PASSWORD"
```

### Health Check Fails

```bash
# Test locally on server
ssh mithrandir "curl http://localhost:9003/api/v1/health"

# Check if service is listening
ssh mithrandir "netstat -tlnp | grep 9003"

# Check Redis connection
ssh mithrandir "redis-cli ping"
```

## CI/CD Architecture

```
┌─────────────────┐
│  Developer      │
│  Local Machine  │
└────────┬────────┘
         │ git push origin main
         ▼
┌─────────────────┐
│  GitHub         │
│  Repository     │
└────────┬────────┘
         │ Triggers
         ▼
┌─────────────────────────────────┐
│  GitHub Actions Runner          │
│  ┌───────────────────────────┐  │
│  │ 1. Run Tests (CI)         │  │
│  │ 2. Connect to Tailscale   │  │
│  │ 3. SSH to Production      │  │
│  │ 4. Deploy Code            │  │
│  │ 5. Restart Service        │  │
│  │ 6. Verify Health          │  │
│  └───────────────────────────┘  │
└────────┬────────────────────────┘
         │ via Tailscale VPN
         ▼
┌─────────────────────────────────┐
│  Production Server (Mithrandir) │
│  100.77.230.53 (Tailscale IP)   │
│  ┌───────────────────────────┐  │
│  │ Transcription Palantir    │  │
│  │ Port: 9003                │  │
│  │ Systemd Service           │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

## Related Documentation

- **CI/CD Setup:** `docs/CICD_SETUP.md` - Detailed setup instructions
- **Development Workflow:** `docs/DEVELOPMENT_WORKFLOW.md` - Development process
- **Production Guidelines:** `docs/PRODUCTION_GUIDELINES.md` - Production rules
- **Project Guide:** `CLAUDE.md` - AI assistant instructions
