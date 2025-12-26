# 🏭 PRODUCTION DEPLOYMENT GUIDELINES

## 🚨 CRITICAL RULE: NEVER USE /tmp FOR PRODUCTION

**❌ NEVER DO THIS:**
```bash
# BAD - Using /tmp for production services
/tmp/whisper-env/
/tmp/my-app/
/tmp/production-data/
```

**✅ ALWAYS DO THIS:**
```bash
# GOOD - Using proper permanent locations
/home/nbost/faster-whisper-env/
/home/nbost/Projects/my-app/
/mnt/data/production-data/
```

## 📁 PROPER DIRECTORY STRUCTURE

### **Production Services:**
```
/home/nbost/
├── Projects/                    # All project code
│   ├── mithrandir-admin/       # Admin dashboard
│   ├── transcription-palantir/ # Transcription service
│   └── unified-api-system/     # API gateway
├── faster-whisper-env/         # Python environments
├── whisper-models/             # ML models
└── .config/                    # Configuration files
```

### **Data Storage:**
```
/mnt/data/
├── whisper-batch/              # Audio processing
│   ├── inbox/                  # Input files
│   ├── completed/              # Processed files
│   └── failed/                 # Failed files
├── databases/                  # Database files
└── backups/                    # Backup storage
```

### **Temporary Files (OK for /tmp):**
```
/tmp/
├── download-cache/             # Temporary downloads
├── processing-temp/            # Temporary processing
└── session-files/              # Temporary session data
```

## 🔧 CONFIGURATION BEST PRACTICES

### **Environment Variables:**
```bash
# Production paths
WHISPER_PYTHON_PATH=/home/nbost/faster-whisper-env/bin/python3
PROJECT_ROOT=/home/nbost/Projects/transcription-palantir
DATA_ROOT=/mnt/data/whisper-batch

# Never use /tmp for production
# WHISPER_PYTHON_PATH=/tmp/whisper-env/bin/python3  # ❌ WRONG
```

### **Service Configuration:**
```typescript
// Good - Production configuration
const config = {
  pythonPath: '/home/nbost/faster-whisper-env/bin/python3',
  dataPath: '/mnt/data/whisper-batch',
  logPath: '/home/nbost/Projects/transcription-palantir/logs'
}

// Bad - Temporary paths
// pythonPath: '/tmp/whisper-env/bin/python3'  // ❌ WRONG
```

## 📋 DEPLOYMENT CHECKLIST

**Before deploying any service:**

- [ ] ✅ All paths use permanent directories (`/home/`, `/mnt/`, `/opt/`)
- [ ] ✅ No production files in `/tmp/`
- [ ] ✅ Virtual environments in permanent locations
- [ ] ✅ Configuration files in proper locations
- [ ] ✅ Log files in permanent directories
- [ ] ✅ Data storage on mounted drives
- [ ] ✅ PID files in service directories (not `/tmp/`)

## 🚨 WHY /tmp IS DANGEROUS

1. **🗑️ Automatic Cleanup:** Files in `/tmp/` can be deleted on reboot
2. **🔄 System Maintenance:** Cleanup scripts regularly purge `/tmp/`
3. **💾 Memory Filesystem:** Some systems mount `/tmp/` in RAM
4. **🔒 Permissions:** `/tmp/` has special permission handling
5. **📊 Monitoring:** Production monitoring doesn't watch `/tmp/`

## 🔍 AUDIT COMMANDS

**Check for /tmp contamination:**
```bash
# Find production files in /tmp
find /tmp -name "*env*" -o -name "*production*" -o -name "*service*"

# Check configuration for /tmp paths
grep -r "/tmp/" ~/Projects/*/config/ ~/Projects/*/.env
```

**Clean up /tmp safely:**
```bash
# Remove only known temporary items
rm -rf /tmp/whisper-env /tmp/transcription*.pid
```

---

**🎯 REMEMBER: If it's important enough to run in production, it's important enough to have a permanent home!**
