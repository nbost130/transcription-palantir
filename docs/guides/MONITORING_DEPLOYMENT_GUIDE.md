# 📊 Monitoring Deployment Guide

## 🎯 Quick Start

### Deploy File Growth Monitor (Recommended)
```bash
# 1. Start the file growth monitor in background
ssh mithrandir 'cd ~/transcription-palantir && nohup scripts/simple-file-growth-monitor.sh > /dev/null 2>&1 & echo $! > /tmp/file-monitor.pid'

# 2. Check if it's running
ssh mithrandir 'ps aux | grep file-growth-monitor | grep -v grep'

# 3. View logs
ssh mithrandir 'tail -f /mnt/data/whisper-batch/logs/file-growth-monitor.log'
```

### Stop File Growth Monitor
```bash
ssh mithrandir 'kill $(cat /tmp/file-monitor.pid 2>/dev/null) 2>/dev/null || pkill -f file-growth-monitor'
```

## 📊 Monitoring Tools

### 1. File Growth Monitor ⭐ **RECOMMENDED**
**Purpose**: Detects stuck transcription processes by monitoring output file growth

**Features**:
- ✅ Monitors output files every 60 seconds
- ✅ Detects files stuck for >5 minutes without growth
- ✅ Shows process information for stuck files
- ✅ Logs all activity with timestamps
- ✅ Maintains state between runs

**Usage**:
```bash
# Run once
scripts/simple-file-growth-monitor.sh

# Run continuously
nohup scripts/simple-file-growth-monitor.sh > /dev/null 2>&1 &
```

**Log Location**: `/mnt/data/whisper-batch/logs/file-growth-monitor.log`

### 2. Monitoring Dashboard
**Purpose**: Real-time system overview and troubleshooting

**Features**:
- Queue status and job counts
- Active job details with runtime
- Process monitoring (CPU, memory)
- Recent file activity
- Health scoring

**Usage**:
```bash
# Single check
node scripts/monitoring-dashboard.js

# Continuous monitoring (refresh every 5s)
node scripts/monitoring-dashboard.js --watch

# Custom refresh interval
node scripts/monitoring-dashboard.js --watch --interval=10000
```

### 3. BullMQ Built-in Stalled Detection
**Purpose**: Automatic stalled job recovery

**Features**:
- ✅ Built into BullMQ queue system
- ✅ Automatically detects and retries stalled jobs
- ✅ No configuration needed

**Status**: Always active, no manual intervention needed

## 🚨 Alert Scenarios

### File Growth Monitor Alerts

**🚨 File Stuck Alert**:
```
[2025-11-21 19:14:21] 🚨 example.txt: STUCK - No growth for 320s (1024 bytes)
[2025-11-21 19:14:21] 🔍 Found whisper processes: 12345
[2025-11-21 19:14:21] ⚠️ Process 12345 has low CPU usage: 0.5%
```

**Actions**:
1. Check if whisper process is actually stuck
2. Kill stuck process if needed: `kill 12345`
3. BullMQ will automatically retry the job

**✅ Normal Growth**:
```
[2025-11-21 19:14:21] 📈 example.txt: +2048 bytes (3072 total) - GROWING
```

### Dashboard Health Alerts

**⚠️ Degraded Health** (Score 70-89):
- Some stalled jobs or long-running processes
- Monitor but may resolve automatically

**❌ Unhealthy** (Score <70):
- Multiple stuck jobs or system issues
- Immediate investigation needed

## 📁 Log Files

### File Growth Monitor
- **Location**: `/mnt/data/whisper-batch/logs/file-growth-monitor.log`
- **Content**: File growth tracking, stuck file alerts, process information
- **Rotation**: Manual (implement logrotate if needed)

### State Files
- **Location**: `/tmp/file-growth-state.txt`
- **Content**: File size tracking between monitor runs
- **Cleanup**: Automatic (removes entries for deleted files)

## 🔧 Configuration

### File Growth Monitor Settings
Edit `scripts/simple-file-growth-monitor.sh`:

```bash
CHECK_INTERVAL=60      # Check every 60 seconds
STUCK_THRESHOLD=300    # 5 minutes without growth = stuck
```

### Dashboard Settings
```bash
# Refresh every 10 seconds
node scripts/monitoring-dashboard.js --watch --interval=10000
```

## 🎯 Best Practices

### 1. Continuous Monitoring
- Run file growth monitor continuously in background
- Check logs periodically for alerts
- Use dashboard for real-time troubleshooting

### 2. Alert Response
- **File stuck >5 minutes**: Investigate whisper process
- **Low CPU process**: May be I/O bound, check system resources
- **Multiple stuck files**: Check system capacity

### 3. Maintenance
- Monitor log file sizes
- Clean up old state files if needed
- Review stuck job patterns for system optimization

## 🚀 Integration with Existing System

### Health Checks
Add to existing health monitoring:
```bash
# Check if file monitor is running
if ! pgrep -f file-growth-monitor > /dev/null; then
    echo "⚠️ File growth monitor not running"
fi

# Check recent alerts
if grep -q "STUCK" /mnt/data/whisper-batch/logs/file-growth-monitor.log; then
    echo "🚨 Stuck files detected"
fi
```

### Systemd Service (Optional)
Create `/etc/systemd/system/transcription-monitor.service`:
```ini
[Unit]
Description=Transcription File Growth Monitor
After=redis.service

[Service]
Type=simple
User=nbost
WorkingDirectory=/home/nbost/transcription-palantir
ExecStart=/home/nbost/transcription-palantir/scripts/simple-file-growth-monitor.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## ✅ Verification

### Test the Monitor
```bash
# 1. Start monitor
scripts/simple-file-growth-monitor.sh &

# 2. Check it detects active jobs
# Should show current queue status and file monitoring

# 3. View logs
tail -f /mnt/data/whisper-batch/logs/file-growth-monitor.log

# 4. Stop monitor
pkill -f file-growth-monitor
```

### Test the Dashboard
```bash
# 1. Run dashboard
node scripts/monitoring-dashboard.js

# Should show:
# - Queue status
# - Active jobs
# - Process information
# - Recent files
# - Overall health score
```
