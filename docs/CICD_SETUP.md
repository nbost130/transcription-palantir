# CI/CD Setup Guide

## 🎯 Overview

This project uses **GitHub Actions** for automated deployment to production. The workflow:
- ✅ Connects to your Tailnet via Tailscale OAuth
- ✅ Deploys to production server via SSH (Tailscale IP only)
- ✅ Automatically triggers on push to `main` (excluding docs-only changes)
- ✅ Runs tests, builds, and restarts the service
- ✅ Verifies deployment with health checks

## 🔐 GitHub Secrets Configuration

The automated deployment workflow requires:
1. **Tailscale OAuth credentials** - To connect GitHub Actions to your Tailnet
2. **SSH access** - To deploy to the production server

Follow these steps to set it up:

### 1. Create Tailscale OAuth Client

GitHub Actions needs to connect to your Tailnet to reach the production server (SSH is only accessible via Tailscale, not public internet).

#### Step 1a: Create the `tag:ci` tag in your Tailnet

1. Go to: https://login.tailscale.com/admin/acls
2. Add to your ACL policy:
   ```json
   "tagOwners": {
     "tag:ci": ["autogroup:admin"],
   }
   ```
3. Save the ACL

#### Step 1b: Create OAuth Client

1. Go to: https://login.tailscale.com/admin/settings/oauth
2. Click **"Generate OAuth client"**
3. **Scopes:** Select **"Auth Keys"** with **WRITE** access ✅
4. **Tags:** Enter `tag:ci`
5. Copy the **Client ID** and **Client Secret**

#### Step 1c: Add to GitHub Secrets

1. Go to: https://github.com/nbost130/transcription-palantir/settings/secrets/actions
2. Click **"New repository secret"**
3. Add two secrets:
   - Name: `TAILSCALE_OAUTH_CLIENT_ID` → Value: (paste client ID)
   - Name: `TAILSCALE_OAUTH_SECRET` → Value: (paste client secret)

### 2. Setup SSH Access

#### Option A: Generate New SSH Key (Recommended)

On your local machine:

```bash
# Generate a dedicated SSH key for GitHub Actions
ssh-keygen -t ed25519 -C "github-actions@transcription-palantir" -f ~/.ssh/github_actions_mithrandir

# This creates:
# - ~/.ssh/github_actions_mithrandir (private key)
# - ~/.ssh/github_actions_mithrandir.pub (public key)
```

Add public key to production server:

```bash
# Copy the public key to mithrandir
ssh-copy-id -i ~/.ssh/github_actions_mithrandir.pub nbost@100.77.230.53

# Or manually:
cat ~/.ssh/github_actions_mithrandir.pub | ssh nbost@100.77.230.53 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
```

Test the connection:

```bash
# Test the key works
ssh -i ~/.ssh/github_actions_mithrandir nbost@100.77.230.53 "echo 'SSH connection successful!'"
```

#### Option B: Use Existing SSH Key

If you already have an SSH key that can access mithrandir:

```bash
# Find your existing key
ls -la ~/.ssh/

# Common names: id_rsa, id_ed25519, id_rsa_automation
```

### 3. Add SSH Secret to GitHub

1. Go to: https://github.com/nbost130/transcription-palantir/settings/secrets/actions

2. Click **"New repository secret"**

3. Name: `MITHRANDIR_SSH_KEY`

4. Value: Copy the **private key** content:
   ```bash
   # For new key:
   cat ~/.ssh/github_actions_mithrandir

   # Or for existing key:
   cat ~/.ssh/id_rsa_automation  # or whatever your key is named
   ```

5. **IMPORTANT:** Paste the entire key including the BEGIN and END tags:
   ```
   -----BEGIN OPENSSH PRIVATE KEY-----
   ... (key content) ...
   -----END OPENSSH PRIVATE KEY-----
   ```

6. Click **"Add secret"**

### 4. Verify Setup

Push a commit to main and check the Actions tab:

```bash
cd ~/dev/transcription-palantir
git push origin main

# Then visit:
# https://github.com/nbost130/transcription-palantir/actions
```

You should see:
- ✅ "🔮 Transcription Palantir CI" workflow running (tests)
- ✅ "🚀 Deploy to Production" workflow running (deployment)

## 🚨 Security Notes

1. **Never commit private keys to git**
2. **Use a dedicated key for CI/CD** (not your personal key)
3. **Limit key permissions** on the server if possible
4. **Rotate keys periodically**
5. **Monitor GitHub Actions logs** for unauthorized access
6. **Tailscale OAuth scope:** Only grant `auth_keys` write access (no other scopes needed)
7. **SSH access:** Production SSH is only accessible via Tailscale (100.77.230.53), not public IP

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

The deployment workflow uses smart path filtering to avoid unnecessary deployments:

| Change Type | CI Runs? | Deploy Runs? | Service Restarts? |
|-------------|----------|--------------|-------------------|
| Code changes (`.ts`, `.js`) | ✅ Yes | ✅ Yes | ✅ Yes |
| Dependencies (`package.json`) | ✅ Yes | ✅ Yes | ✅ Yes |
| Documentation (`.md`, `docs/`) | ✅ Yes | ❌ No | ❌ No |
| Config files (`.gitignore`, `LICENSE`) | ✅ Yes | ❌ No | ❌ No |

**Trigger Conditions:**
- ✅ Push to `main` branch with code changes
- ✅ Manual workflow dispatch
- ❌ Pushes to other branches (no deployment)
- ❌ Changes to only `.md` files (deployment skipped, CI still runs)
- ❌ Changes to only `docs/` directory (deployment skipped, CI still runs)
- ❌ Changes to only `.gitignore` or `LICENSE` (deployment skipped)

**Path Ignore Configuration:**
```yaml
paths-ignore:
  - '**.md'        # All markdown files
  - 'docs/**'      # Documentation directory
  - 'LICENSE'      # License file
  - '.gitignore'   # Git ignore file
```

### Deployment Steps

1. **Checkout code** - Gets latest from GitHub
2. **Connect to Tailscale** - Establishes VPN connection to Tailnet
3. **Setup SSH** - Configures SSH key from secrets
4. **Add SSH known hosts** - Scans production server SSH fingerprint
5. **Deploy to production** - SSH to mithrandir (100.77.230.53) and run:
   - `git pull origin main`
   - `npm install`
   - `npm run build`
   - `sudo systemctl restart transcription-palantir`
6. **Verify deployment** - Confirms service is healthy via health check
7. **Deployment summary** - Posts summary to workflow output

### Rollback

If deployment fails or causes issues:

```bash
# SSH to production
ssh mithrandir

# Check what commit is deployed
cd /home/nbost/transcription-palantir
git log -1
```

The rollback steps themselves live in **one place**:
[`docs/DEPLOYMENT.md` → Rollback](DEPLOYMENT.md#rollback). They are not repeated
here, because the copy that used to be here had drifted twice over: it used
`git reset --hard` (denied on Mithrandir, and it destroys local drift silently)
and `sudo systemctl restart` (wrong — the unit is a systemd **user** unit, so
the command is `systemctl --user restart transcription-palantir`).

Then fix the issue locally and push the fix.

## 🎯 Next Steps

After setting up CI/CD:

1. ✅ Add `TAILSCALE_OAUTH_CLIENT_ID` secret to GitHub
2. ✅ Add `TAILSCALE_OAUTH_SECRET` secret to GitHub
3. ✅ Add `MITHRANDIR_SSH_KEY` secret to GitHub
4. ✅ Test deployment with a small change
5. ✅ Monitor the Actions tab for success
6. ✅ Verify production health endpoints
7. ✅ Document any custom deployment needs
8. 📚 Share workflow docs with team

## 📚 Additional Resources

- **Tailscale GitHub Action:** https://github.com/tailscale/github-action
- **Tailscale OAuth Clients:** https://tailscale.com/kb/1215/oauth-clients
- **GitHub Actions Secrets:** https://docs.github.com/en/actions/security-guides/encrypted-secrets
- **Workflow Syntax:** https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions

## ✅ Setup Checklist

Use this checklist to verify your CI/CD setup:

- [ ] Created `tag:ci` in Tailscale ACL
- [ ] Generated Tailscale OAuth client with `auth_keys` write scope
- [ ] Added `TAILSCALE_OAUTH_CLIENT_ID` to GitHub Secrets
- [ ] Added `TAILSCALE_OAUTH_SECRET` to GitHub Secrets
- [ ] Generated or identified SSH key for GitHub Actions
- [ ] Added SSH public key to production server's `~/.ssh/authorized_keys`
- [ ] Tested SSH connection from local machine
- [ ] Added `MITHRANDIR_SSH_KEY` (private key) to GitHub Secrets
- [ ] Pushed a test commit to `main` branch
- [ ] Verified CI workflow runs successfully
- [ ] Verified deployment workflow runs successfully
- [ ] Confirmed production service restarted
- [ ] Verified health endpoint responds correctly
- [ ] Tested documentation-only change (should skip deployment)
- [ ] Reviewed deployment logs in GitHub Actions
- [ ] Documented any custom configuration or issues

