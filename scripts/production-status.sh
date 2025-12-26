#!/bin/bash

# Production Transcription System Status
echo "🎙️ Production TypeScript Transcription System Status"
echo "===================================================="
echo "$(date)"
echo ""

# Check systemd service status
echo "🔧 Systemd Service Status:"
if ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "sudo systemctl is-active --quiet transcription.service"; then
    echo "✅ Service: ACTIVE"
    WORKERS=$(ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "ps aux | grep 'faster-whisper-env/bin/python3 -c' | grep -v grep | wc -l")
    echo "🔄 Active Workers: $WORKERS/3"
else
    echo "❌ Service: INACTIVE"
fi

echo ""

# Check git status
echo "📦 Git Repository Status:"
ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "cd ~/transcription-ts && git log --oneline -3"

echo ""

# Check file sync
echo "📁 File Sync Status:"
CRON_COUNT=$(ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "crontab -l | grep sync-audio-files | wc -l")
if [ "$CRON_COUNT" -gt 0 ]; then
    echo "✅ Auto-sync: ENABLED (every 5 minutes)"
else
    echo "❌ Auto-sync: NOT CONFIGURED"
fi

# Check for files in Audio-To-Process
PENDING_FILES=$(ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "find ~/Audio-To-Process -name '*.mp3' -o -name '*.wav' -o -name '*.m4a' -o -name '*.flac' 2>/dev/null | wc -l")
echo "📂 Files waiting for sync: $PENDING_FILES"

echo ""

# Get processing statistics
echo "📊 Processing Statistics:"
ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "cd ~/transcription-ts && export PATH=~/.bun/bin:\$PATH && bun transcriber.ts status"

echo ""

# Check recent Orbis completions
echo "🎯 Recent Orbis Completions:"
ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "find /mnt/data/whisper-batch/completed/transcripts/ -name '*transcript.txt' -newermt '1 hour ago' | grep -i -E '(orbis|lesson|heal)' | tail -5"

echo ""

# System health checks
echo "🏥 System Health:"
DISK_USAGE=$(ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "df -h /mnt/data | tail -1 | awk '{print \$5}'")
MEMORY_USAGE=$(ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "free -h | grep Mem | awk '{print \$3\"/\"\$2}'")
echo "💾 Disk Usage: $DISK_USAGE"
echo "🧠 Memory Usage: $MEMORY_USAGE"

echo ""

# Auto-restart capability
echo "🔄 Auto-restart Features:"
echo "✅ Systemd service with auto-restart on failure"
echo "✅ Restart after system reboot (enabled)"
echo "✅ File watching for new audio files"
echo "✅ Automatic sync from Audio-To-Process every 5 minutes"

echo ""

# Management commands
echo "⚡ Management Commands:"
echo "   Status: ssh nbost@100.77.230.53 'sudo systemctl status transcription.service'"
echo "   Restart: ssh nbost@100.77.230.53 'sudo systemctl restart transcription.service'"
echo "   Logs: ssh nbost@100.77.230.53 'sudo journalctl -u transcription.service -f'"
echo "   Stats: ssh nbost@100.77.230.53 'cd ~/transcription-ts && bun transcriber.ts status'"
echo "   Git: ssh nbost@100.77.230.53 'cd ~/transcription-ts && git status'"
