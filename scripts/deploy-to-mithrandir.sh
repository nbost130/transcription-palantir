#!/bin/bash
#
# Deploy transcription-palantir to Mithrandir
# Preserves .env configuration on server
#

set -e

REMOTE_USER="nbost"
REMOTE_HOST="mithrandir"
REMOTE_DIR="~/transcription-palantir"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "🔮 Deploying Transcription Palantir to Mithrandir"
echo "================================================="

# Backup remote .env
echo "📦 Backing up remote .env..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "cp ${REMOTE_DIR}/.env ${REMOTE_DIR}/.env.backup"

# Deploy code (excluding .env)
echo "🚀 Deploying code..."
rsync -avz \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.env' \
  --exclude 'logs/*.log' \
  --exclude 'transcripts' \
  --exclude 'demo-audio' \
  --exclude 'demo-transcripts' \
  --exclude 'audio-samples' \
  "${LOCAL_DIR}/" "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"

# Build on remote
echo "🔨 Building on remote..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && export PATH=\"\$HOME/.bun/bin:\$PATH\" && bun run build"

# Restore .env
echo "♻️  Restoring .env..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "mv ${REMOTE_DIR}/.env.backup ${REMOTE_DIR}/.env"

# Restart service
echo "🔄 Restarting service..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && pkill -f 'bun.*transcription' || true && sleep 3 && nohup /home/nbost/.bun/bin/bun run dist/index.js > logs/service.log 2>&1 &"

# Wait and check status
echo "⏳ Waiting for service to start..."
sleep 5

ssh ${REMOTE_USER}@${REMOTE_HOST} "cd ${REMOTE_DIR} && ps aux | grep 'bun.*transcription' | grep -v grep && echo '✅ Service is running' || echo '❌ Service failed to start'"

echo ""
echo "✅ Deployment complete!"
echo ""
echo "To check logs:"
echo "  ssh ${REMOTE_HOST} 'tail -f ~/transcription-palantir/logs/service.log'"
echo ""
echo "To check status:"
echo "  ssh ${REMOTE_HOST} 'cd ~/transcription-palantir && ps aux | grep bun | grep -v grep'"
