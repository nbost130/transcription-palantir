# Development Workflow

## 🎯 Core Principles

1. **Never edit code directly on production servers**
2. **All changes go through git**
3. **Automated deployment on push to main**
4. **No manual backup files** (git is your backup)

## 📁 Repository Structure

```
~/dev/transcription-palantir/     # Local development
  ├── src/                         # Source code
  ├── scripts/                     # Production scripts
  ├── docs/                        # Documentation
  └── .github/workflows/           # CI/CD automation

/home/nbost/transcription-palantir/  # Production (mithrandir)
  ├── Automatically synced via GitHub Actions
  └── DO NOT EDIT DIRECTLY
```

## 🔄 Development Process

### 1. Make Changes Locally

```bash
cd ~/dev/transcription-palantir

# Create a feature branch (optional but recommended)
git checkout -b feature/my-feature

# Make your changes
# Edit files, test locally

# Check what changed
git status
git diff
```

### 2. Test Locally

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Run locally for testing
npm run dev
```

### 3. Commit Changes

```bash
# Stage your changes
git add src/api/routes/services.ts

# Commit with descriptive message
git commit -m "feat: Add new service endpoint"

# Use conventional commit format:
# - feat: New feature
# - fix: Bug fix
# - chore: Maintenance
# - docs: Documentation
# - refactor: Code refactoring
```

### 4. Push to GitHub

```bash
# Push to main (triggers auto-deployment)
git push origin main

# Or push feature branch and create PR
git push origin feature/my-feature
# Then create PR on GitHub
```

### 5. Automated Deployment

When you push to `main`:
1. ✅ GitHub Actions runs CI tests
2. ✅ If tests pass, deploys to production
3. ✅ Pulls latest code on mithrandir
4. ✅ Runs `npm install` and `npm run build`
5. ✅ Restarts the service
6. ✅ Verifies health check

**Monitor deployment:** https://github.com/nbost130/transcription-palantir/actions

## 🚨 Emergency Fixes

If you need to make an emergency fix:

```bash
# Make the fix locally
git add <files>
git commit -m "fix: Emergency fix for production issue"
git push origin main

# Deployment happens automatically in ~2-3 minutes
# Monitor: https://github.com/nbost130/transcription-palantir/actions
```

## 🔍 Checking Production Status

```bash
# From local machine
curl http://100.77.230.53:9003/api/v1/health

# SSH to production (read-only checks)
ssh mithrandir "cd /home/nbost/transcription-palantir && git status"
ssh mithrandir "sudo systemctl status transcription-palantir"
ssh mithrandir "sudo journalctl -u transcription-palantir -n 50"
```

## ❌ What NOT to Do

1. **Don't edit files directly on production**
   ```bash
   # ❌ WRONG
   ssh mithrandir "vim /home/nbost/transcription-palantir/src/api/server.ts"
   ```

2. **Don't create manual backup files**
   ```bash
   # ❌ WRONG
   cp server.ts server.ts.bak
   ```
   Git is your backup system!

3. **Don't commit temporary/debug files**
   - No `debug-*.js`, `fix-*.js`, `test-*.patch` files
   - No `.bak`, `.backup`, `.old` files
   - Use `.gitignore` for build artifacts

4. **Don't skip tests**
   ```bash
   # ❌ WRONG
   git push --no-verify
   ```

## 🔧 Manual Deployment (if needed)

If GitHub Actions is down or you need manual control:

```bash
ssh mithrandir << 'ENDSSH'
  cd /home/nbost/transcription-palantir
  git pull origin main
  npm install
  npm run build
  sudo systemctl restart transcription-palantir
  sleep 3
  curl http://localhost:9003/api/v1/health
ENDSSH
```

## 📊 Monitoring

- **Service Health:** http://100.77.230.53:9003/api/v1/health
- **Consul Services:** http://100.77.230.53:9003/api/services/health
- **Dashboard:** http://100.77.230.53:3000/services
- **GitHub Actions:** https://github.com/nbost130/transcription-palantir/actions

## 🎓 Best Practices

1. **Commit often** - Small, focused commits are better
2. **Write good commit messages** - Future you will thank you
3. **Test before pushing** - Run `npm test` and `npm run build`
4. **Use feature branches** - For larger changes
5. **Review your changes** - Use `git diff` before committing
6. **Keep production clean** - No manual edits, no backup files

