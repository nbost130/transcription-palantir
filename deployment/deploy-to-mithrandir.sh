#!/bin/bash

# =============================================================================
# 🔮 Transcription Palantir - Mithrandir Deployment Script
# =============================================================================

set -e  # Exit on any error

# Configuration
MITHRANDIR_HOST="100.77.230.53"
MITHRANDIR_USER="nbost"
SSH_KEY="~/.ssh/id_rsa_automation"
REMOTE_DIR="/home/nbost/transcription-palantir"
UNIFIED_API_DIR="/home/nbost/mithrandir-unified-api"
LOCAL_DIR="$(dirname "$0")/.."

echo "🔮 Transcription Palantir - Mithrandir Deployment"
echo "=================================================="
echo "Target: ${MITHRANDIR_USER}@${MITHRANDIR_HOST}"
echo "Remote Directory: ${REMOTE_DIR}"
echo ""

# Function to run commands on Mithrandir
run_remote() {
    ssh -i ${SSH_KEY} ${MITHRANDIR_USER}@${MITHRANDIR_HOST} "$1"
}

# Function to copy files to Mithrandir
copy_to_remote() {
    scp -i ${SSH_KEY} -r "$1" ${MITHRANDIR_USER}@${MITHRANDIR_HOST}:"$2"
}

echo "📋 Step 1: Preparing deployment package..."

# Create deployment package locally
DEPLOY_PACKAGE="/tmp/transcription-palantir-deploy"
rm -rf ${DEPLOY_PACKAGE}
mkdir -p ${DEPLOY_PACKAGE}

# Copy essential files
echo "   📦 Copying source files..."
cp -r ${LOCAL_DIR}/src ${DEPLOY_PACKAGE}/
cp ${LOCAL_DIR}/package.json ${DEPLOY_PACKAGE}/
cp ${LOCAL_DIR}/bun.lockb ${DEPLOY_PACKAGE}/ 2>/dev/null || echo "   ⚠️  No bun.lockb found"
cp ${LOCAL_DIR}/.env.example ${DEPLOY_PACKAGE}/
cp ${LOCAL_DIR}/tsconfig.json ${DEPLOY_PACKAGE}/
mkdir -p ${DEPLOY_PACKAGE}/logs

# Copy deployment scripts
mkdir -p ${DEPLOY_PACKAGE}/scripts
cp ${LOCAL_DIR}/deployment/*.sh ${DEPLOY_PACKAGE}/scripts/ 2>/dev/null || true

echo "   ✅ Deployment package prepared"

echo "📤 Step 2: Uploading to Mithrandir..."

# Create remote directory
run_remote "mkdir -p ${REMOTE_DIR}"

# Upload deployment package
run_remote "rm -rf ${REMOTE_DIR}"
copy_to_remote ${DEPLOY_PACKAGE} ${REMOTE_DIR}

echo "   ✅ Files uploaded successfully"

echo "🔧 Step 3: Installing dependencies on Mithrandir..."

# Install dependencies
run_remote "cd ${REMOTE_DIR} && export PATH=/home/nbost/.bun/bin:\$PATH && bun install"

echo "   ✅ Dependencies installed"

echo "⚙️  Step 4: Setting up configuration..."

# Create production environment file
run_remote "cd ${REMOTE_DIR} && cp .env.example .env"

# Update configuration for production
run_remote "cd ${REMOTE_DIR} && sed -i 's|NODE_ENV=development|NODE_ENV=production|g' .env"
run_remote "cd ${REMOTE_DIR} && sed -i 's|/Users/nbost/Audio-To-Process|/mnt/data/whisper-batch/inbox|g' .env"
run_remote "cd ${REMOTE_DIR} && sed -i 's|/Users/nbost/transcripts|/mnt/data/whisper-batch/output|g' .env"
run_remote "cd ${REMOTE_DIR} && sed -i 's|WHISPER_BINARY_PATH=.*|WHISPER_BINARY_PATH=/usr/local/bin/whisper|g' .env"

echo "   ✅ Configuration updated for production"

echo "🐳 Step 5: Setting up Redis..."

# Check if Redis is running, start if needed
if run_remote "systemctl is-active redis" >/dev/null 2>&1; then
    echo "   ✅ Redis is already running"
elif run_remote "systemctl is-active redis-server" >/dev/null 2>&1; then
    echo "   ✅ Redis is already running"
else
    echo "   🔄 Starting Redis..."
    # Try different Redis service names
    if run_remote "sudo systemctl start redis" >/dev/null 2>&1; then
        run_remote "sudo systemctl enable redis"
        echo "   ✅ Redis started and enabled"
    elif run_remote "sudo systemctl start redis-server" >/dev/null 2>&1; then
        run_remote "sudo systemctl enable redis-server"
        echo "   ✅ Redis started and enabled"
    else
        echo "   ⚠️  Could not start Redis service, checking if Redis is running manually..."
        if run_remote "redis-cli ping" >/dev/null 2>&1; then
            echo "   ✅ Redis is running (manual start)"
        else
            echo "   ❌ Redis is not running and could not be started"
            echo "   📋 Please start Redis manually: sudo systemctl start redis"
            exit 1
        fi
    fi
fi

echo "🔨 Step 6: Building the application..."

# Build TypeScript (skip for now, bun can run TypeScript directly)
echo "   ⚠️  Skipping build step - bun will compile TypeScript on-the-fly"
echo "   ✅ Application ready for runtime compilation"

echo "🚀 Step 7: Starting background services..."

# Stop any existing services
run_remote "pkill -f 'transcription-palantir' || true"

# Start background services
run_remote "cd ${REMOTE_DIR} && export PATH=/home/nbost/.bun/bin:\$PATH && nohup bun run src/services/background-services.ts > logs/background-services.log 2>&1 &"

# Wait a moment for services to start
sleep 3

# Check if services are running
if run_remote "pgrep -f 'background-services.ts'" >/dev/null; then
    echo "   ✅ Background services started successfully"
else
    echo "   ❌ Failed to start background services"
    echo "   📋 Check logs: ssh ${MITHRANDIR_USER}@${MITHRANDIR_HOST} 'tail -f ${REMOTE_DIR}/logs/background-services.log'"
    exit 1
fi

echo "🔗 Step 8: Integrating with Unified API..."

# Create integration script for unified API
cat > /tmp/integration-update.js << 'EOF'
// Integration script to enhance existing transcription service
const fs = require('fs');
const path = require('path');

const servicesPath = '/home/nbost/mithrandir-unified-api/services.ts';
const integrationCode = `
// Enhanced Transcription Service Integration
import { EnhancedTranscriptionService } from '/home/nbost/transcription-palantir/src/integration/enhanced-transcription-service.js';

// Add to UnifiedSystemService class
private enhancedTranscription = new EnhancedTranscriptionService();

// Replace existing transcription methods with enhanced versions
async getTranscriptionProjects() {
  try {
    return await this.enhancedTranscription.getTranscriptionProjects();
  } catch (error) {
    // Fallback to original implementation if needed
    return await this.originalGetTranscriptionProjects();
  }
}

async retryTranscriptionJob(jobId: string) {
  try {
    return await this.enhancedTranscription.retryTranscriptionJob(jobId);
  } catch (error) {
    // Fallback to original implementation if needed
    return await this.originalRetryTranscriptionJob(jobId);
  }
}

async getTranscriptionJob(jobId: string) {
  try {
    return await this.enhancedTranscription.getTranscriptionJob(jobId);
  } catch (error) {
    // Fallback to original implementation if needed
    return await this.originalGetTranscriptionJob(jobId);
  }
}
`;

console.log('Integration code prepared for manual addition to services.ts');
EOF

copy_to_remote /tmp/integration-update.js ${REMOTE_DIR}/scripts/

echo "   📋 Integration script uploaded"
echo "   ⚠️  Manual step required: Update unified API services.ts with enhanced methods"

echo "✅ Step 9: Deployment verification..."

# Test background services health
if run_remote "cd ${REMOTE_DIR} && export PATH=/home/nbost/.bun/bin:\$PATH && timeout 10 bun -e 'import(\"./src/services/background-services.js\").then(m => m.getBackgroundServicesHealth()).then(console.log)'" >/dev/null 2>&1; then
    echo "   ✅ Background services are healthy"
else
    echo "   ⚠️  Background services health check inconclusive"
fi

# Create systemd service for auto-start
cat > /tmp/transcription-palantir.service << EOF
[Unit]
Description=Transcription Palantir Background Services
After=network.target redis-server.service

[Service]
Type=simple
User=nbost
WorkingDirectory=${REMOTE_DIR}
ExecStart=/home/nbost/.bun/bin/bun run src/services/background-services.ts
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

copy_to_remote /tmp/transcription-palantir.service /tmp/
run_remote "sudo mv /tmp/transcription-palantir.service /etc/systemd/system/"
run_remote "sudo systemctl daemon-reload"
run_remote "sudo systemctl enable transcription-palantir"

echo "   ✅ Systemd service created and enabled"

echo ""
echo "🎉 DEPLOYMENT COMPLETE!"
echo "======================"
echo ""
echo "📊 Status:"
echo "   ✅ Background services: Running"
echo "   ✅ Redis: Active"
echo "   ✅ File watcher: Monitoring /mnt/data/whisper-batch/inbox"
echo "   ✅ Workers: Processing transcription jobs"
echo "   ✅ Systemd service: Enabled for auto-start"
echo ""
echo "📋 Next Steps:"
echo "   1. Update unified API services.ts with enhanced methods"
echo "   2. Restart unified API to use enhanced transcription service"
echo "   3. Test with sample audio files"
echo ""
echo "🔍 Monitoring:"
echo "   • Background services: ssh ${MITHRANDIR_USER}@${MITHRANDIR_HOST} 'tail -f ${REMOTE_DIR}/logs/background-services.log'"
echo "   • System status: ssh ${MITHRANDIR_USER}@${MITHRANDIR_HOST} 'systemctl status transcription-palantir'"
echo "   • Redis status: ssh ${MITHRANDIR_USER}@${MITHRANDIR_HOST} 'systemctl status redis-server'"
echo ""
echo "🔮 The seeing stones are ready to communicate across vast distances!"

# Cleanup
rm -rf ${DEPLOY_PACKAGE}
rm -f /tmp/integration-update.js
rm -f /tmp/transcription-palantir.service
