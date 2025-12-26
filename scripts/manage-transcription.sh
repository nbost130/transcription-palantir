#!/bin/bash

# Comprehensive Transcription Management Script
echo "🎙️ Transcription Management System"
echo "=================================="
echo "$(date)"
echo ""

# Function to show current status
show_status() {
    echo "📊 Current Status:"
    
    # Service status
    WORKERS=$(ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "ps aux | grep whisper_batch.py | grep -v grep | wc -l")
    echo "   Active workers: $WORKERS/4"
    
    # File counts
    SMALL_FILES=$(ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "find /mnt/data/whisper-batch/inbox -name '*.mp3' | wc -l")
    LARGE_FILES=$(ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "find /mnt/data/whisper-batch/inbox-large-files -name '*.mp3' 2>/dev/null | wc -l")
    ORBIS_PENDING=$(ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "find '/mnt/data/whisper-batch/inbox/Orbis Ministries' -name '*.mp3' 2>/dev/null | wc -l")
    ORBIS_COMPLETED=$(ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "find /mnt/data/whisper-batch/completed/transcripts/ -name '*Orbis*' 2>/dev/null | wc -l")
    
    echo "   Small/Medium files in queue: $SMALL_FILES"
    echo "   Large files (held): $LARGE_FILES"
    echo "   Orbis files pending: $ORBIS_PENDING"
    echo "   Orbis transcripts completed: $ORBIS_COMPLETED"
    
    # Recent completions
    RECENT=$(ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "find /mnt/data/whisper-batch/completed/transcripts/ -name '*.txt' -newermt '1 hour ago' | wc -l")
    echo "   Files completed in last hour: $RECENT"
    
    # Overall stats
    echo ""
    echo "📈 Overall Stats:"
    ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "cd ~/whisper-batch && /home/nbost/faster-whisper-env/bin/python3 scripts/whisper_batch.py --stats" | grep -E "(completed_files|pending_files|failed_files)"
}

# Function to process large files
process_large_files() {
    echo ""
    echo "🔄 Processing Large Files..."
    echo "Moving large files back to main queue (5 at a time)"
    
    ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "find /mnt/data/whisper-batch/inbox-large-files -name '*.mp3' | head -5 | xargs -I {} mv {} /mnt/data/whisper-batch/inbox/"
    
    MOVED=$(ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "find /mnt/data/whisper-batch/inbox-large-files -name '*.mp3' | wc -l")
    echo "Large files remaining: $MOVED"
}

# Function to show recent completions
show_recent() {
    echo ""
    echo "🆕 Recent Completions (last 2 hours):"
    ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "find /mnt/data/whisper-batch/completed/transcripts/ -name '*.txt' -newermt '2 hours ago' | tail -5"
}

# Main execution
case "${1:-status}" in
    "status")
        show_status
        show_recent
        ;;
    "large")
        show_status
        process_large_files
        ;;
    "restart")
        echo "🔄 Restarting transcription service..."
        ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "pkill -f whisper_batch.py; pkill -f concurrent_watcher"
        sleep 5
        ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "cd /home/nbost/whisper-batch && ./start_concurrent_system.sh" &
        echo "Service restarted!"
        ;;
    *)
        echo "Usage: $0 [status|large|restart]"
        echo "  status - Show current status (default)"
        echo "  large  - Move 5 large files back to processing queue"
        echo "  restart - Restart the transcription service"
        ;;
esac

echo ""
echo "⏱️  Run '$0 large' to process large files when small ones are done"
