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

### Manual deploy on Mithrandir itself (canonical)

Run this **on Mithrandir**, in `~/transcription-palantir`. It is the fallback
when `deploy.yml` fails at its Tailscale SSH step.

**Do not use `git reset --hard origin/main`.** That is what this procedure
replaces. Two reasons, and the second is the one that matters:

1. `git reset --hard*` is on the deny list on this box, so every run needs a
   one-off approval — which trains whoever is deploying to click through a
   guard at 2am.
2. It *silently destroys* local modifications. On a deploy box a modified file
   is either an accident or somebody's undocumented hotfix; either way it is
   evidence, and the old procedure deleted it without printing a word. A hard
   reset does not fix drift, it hides it.

The end state is identical: the working tree is exactly `origin/main`, with
nothing local surviving in it. The difference is that drift is **parked, not
destroyed**, and anything this procedure cannot resolve stops the deploy loudly
instead of being papered over.

```bash
cd ~/transcription-palantir
git fetch origin main

# 1. Park local drift instead of destroying it. Silent on a clean tree.
if [ -n "$(git status --porcelain)" ]; then
  git stash push -u -m "predeploy-$(date -u +%Y%m%dT%H%M%SZ)" \
    || { echo "ABORT: local changes present and could not be stashed"; exit 1; }
  echo "!! LOCAL DRIFT PARKED in stash@{0} - recover with: git stash show -p stash@{0}"
fi

# 2. Refuse loudly if this box carries commits origin/main does not have.
AHEAD=$(git rev-list --count origin/main..HEAD)
if [ "$AHEAD" != 0 ]; then
  echo "ABORT: $AHEAD commit(s) exist only on this box. Do NOT deploy; push or drop them first."
  git rev-list --pretty=oneline --abbrev-commit origin/main..HEAD
  exit 1
fi

# 3. Fast-forward onto origin/main.
git merge --ff-only origin/main || { echo "ABORT: fast-forward to origin/main failed"; exit 1; }

# 4. Prove the end state instead of assuming it.
if [ -n "$(git status --porcelain)" ] || [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "ABORT: working tree still does not match origin/main"; exit 1
fi
echo "OK  tree == origin/main @ $(git rev-parse --short HEAD)"

# 5. Only now: build and restart.
npm install && npm run build && systemctl --user restart transcription-palantir

# 6. Readiness, not liveness. `/` and /api/v1/health stayed green through two incidents.
sleep 3 && curl -sf http://127.0.0.1:9003/api/v1/ready || echo "!! /api/v1/ready NOT healthy"
```

**Reading the output at 2am.** Steps 1-4 print nothing at all on the ordinary
path except the final `OK` line. So:

| What you see | What it means | What to do |
|---|---|---|
| only `OK tree == origin/main @ <sha>` | clean box, fast-forwarded, verified | carry on to the build |
| `!! LOCAL DRIFT PARKED …` then `OK …` | somebody had edited files here; they are in `stash@{0}` | deploy is fine; read the stash afterwards and find out who |
| `ABORT: N commit(s) exist only on this box` | someone committed a hotfix here and never pushed it | **stop.** Push or drop those commits first — do not deploy over them |
| `ABORT: working tree still does not match origin/main` | the end state was not reached | **stop.** Nothing was built or restarted |

Every abort exits non-zero *before* `npm install`, so a failed sync can never
half-deploy.

Two things this deliberately does **not** do. It does not `git pull --ff-only`,
because that fails outright on a dirty tree and leaves you improvising. And it
does not use `git diff` for the end-state check: raw `git diff` is blocked by
`AxiCliGuard` inside a Claude Code session on this box, so the check is written
with `git rev-parse`, which is both ungated and a stricter assertion (it
compares the commit, not just the content).

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

# Roll back WITHOUT a hard reset (denied on this box, and it destroys drift).
#
# Park local changes FIRST, unconditionally. Do not rely on `git switch` to
# stop you: measured on this box, it refuses only when a dirty file also
# differs between the two commits. Edit a file the rollback does not touch and
# `switch --detach` succeeds and carries your edit into the rolled-back tree —
# a silent contaminated rollback, which is the worst outcome of the three.
[ -z "$(git status --porcelain)" ] || git stash push -u -m "prerollback-$(date -u +%Y%m%dT%H%M%SZ)"

# --detach leaves `main` pointing at the bad commit, which is what makes this
# reversible: `git switch main` puts you back.
git switch --detach HEAD~1          # previous commit
git switch --detach <commit-sha>    # or a specific one

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

