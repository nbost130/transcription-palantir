# CI/CD Setup Guide

## 🔐 GitHub Secrets Configuration

The automated deployment workflow requires SSH access to the production server. Follow these steps to set it up:

### 1. Generate SSH Key for GitHub Actions

On your local machine:

```bash
# Generate a dedicated SSH key for GitHub Actions
ssh-keygen -t ed25519 -C "github-actions@transcription-palantir" -f ~/.ssh/github_actions_mithrandir

# This creates:
# - ~/.ssh/github_actions_mithrandir (private key)
# - ~/.ssh/github_actions_mithrandir.pub (public key)
```

### 2. Add Public Key to Production Server

```bash
# Copy the public key to mithrandir
ssh-copy-id -i ~/.ssh/github_actions_mithrandir.pub nbost@100.77.230.53

# Or manually:
cat ~/.ssh/github_actions_mithrandir.pub | ssh nbost@100.77.230.53 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

### 3. Test SSH Connection

```bash
# Test the key works
ssh -i ~/.ssh/github_actions_mithrandir nbost@100.77.230.53 "echo 'SSH connection successful!'"
```

### 4. Add Secret to GitHub

1. Go to: https://github.com/nbost130/transcription-palantir/settings/secrets/actions

2. Click **"New repository secret"**

3. Name: `MITHRANDIR_SSH_KEY`

4. Value: Copy the **private key** content:
   ```bash
   cat ~/.ssh/github_actions_mithrandir
   ```
   
5. Paste the entire key (including `-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END OPENSSH PRIVATE KEY-----`)

6. Click **"Add secret"**

### 5. Verify Setup

Push a commit to main and check the Actions tab:

```bash
cd ~/dev/transcription-palantir
git push origin main

# Then visit:
# https://github.com/nbost130/transcription-palantir/actions
```

## 🔧 Alternative: Use Existing SSH Key

If you already have an SSH key that can access mithrandir:

```bash
# Find your existing key
ls -la ~/.ssh/

# Common names: id_rsa, id_ed25519, id_rsa_automation

# Copy the PRIVATE key content
cat ~/.ssh/id_rsa_automation  # or whatever your key is named

# Add to GitHub Secrets as MITHRANDIR_SSH_KEY
```

## 🚨 Security Notes

1. **Never commit private keys to git**
2. **Use a dedicated key for CI/CD** (not your personal key)
3. **Limit key permissions** on the server if possible
4. **Rotate keys periodically**
5. **Monitor GitHub Actions logs** for unauthorized access

## 🧪 Testing the Workflow

### Manual Trigger

You can manually trigger deployment from GitHub:

1. Go to: https://github.com/nbost130/transcription-palantir/actions
2. Click "🚀 Deploy to Production"
3. Click "Run workflow"
4. Select branch: `main`
5. Click "Run workflow"

### Automatic Trigger

Push any commit to `main`:

```bash
git commit --allow-empty -m "test: Trigger deployment"
git push origin main
```

## 📊 Monitoring Deployments

### GitHub Actions UI

- **All workflows:** https://github.com/nbost130/transcription-palantir/actions
- **Latest deployment:** Click on the most recent "🚀 Deploy to Production" run
- **View logs:** Click on each step to see detailed output

### Production Server

```bash
# Check service status
ssh mithrandir "sudo systemctl status transcription-palantir"

# View recent logs
ssh mithrandir "sudo journalctl -u transcription-palantir -n 100 --no-pager"

# Check health
curl http://100.77.230.53:9003/api/v1/health
```

## 🔄 Workflow Behavior

### What Triggers Deployment

- ✅ Push to `main` branch
- ✅ Manual workflow dispatch
- ❌ Pushes to other branches (no deployment)
- ❌ Changes to only `.md` files or `docs/` (skipped)

### Deployment Steps

1. **Checkout code** - Gets latest from GitHub
2. **Setup SSH** - Configures SSH key from secrets
3. **Deploy** - SSH to mithrandir and run:
   - `git pull origin main`
   - `npm install`
   - `npm run build`
   - `sudo systemctl restart transcription-palantir`
   - Health check verification
4. **Verify** - Confirms service is healthy
5. **Summary** - Posts deployment summary

### Rollback

If deployment fails or causes issues:

```bash
# SSH to production
ssh mithrandir

# Check what commit is deployed
cd /home/nbost/transcription-palantir
git log -1

# Rollback to previous commit
git reset --hard HEAD~1
npm install
npm run build
sudo systemctl restart transcription-palantir

# Or rollback to specific commit
git reset --hard <commit-sha>
npm install
npm run build
sudo systemctl restart transcription-palantir
```

Then fix the issue locally and push the fix.

## 🎯 Next Steps

After setting up CI/CD:

1. ✅ Add `MITHRANDIR_SSH_KEY` secret to GitHub
2. ✅ Test deployment with a small change
3. ✅ Monitor the Actions tab for success
4. ✅ Verify production health endpoints
5. ✅ Document any custom deployment needs
6. 📚 Share workflow docs with team

