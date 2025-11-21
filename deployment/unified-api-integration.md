# 🔗 Unified API Integration Instructions

## Overview

This document explains how to integrate the enhanced transcription system with your existing unified API without breaking changes.

## Integration Steps

### Step 1: Add Enhanced Service Import

Add this import to the top of `mithrandir-unified-api/services.ts`:

```typescript
import { EnhancedTranscriptionService } from '/home/nbost/transcription-palantir/src/integration/enhanced-transcription-service.js';
```

### Step 2: Add Enhanced Service to UnifiedSystemService Class

Add this property to the `UnifiedSystemService` class:

```typescript
export class UnifiedSystemService {
  private static instance: UnifiedSystemService;
  private enhancedTranscription = new EnhancedTranscriptionService();
  
  // ... existing code ...
```

### Step 3: Replace Transcription Methods

Replace the existing transcription methods with enhanced versions:

#### Replace `getTranscriptionProjects()`:

```typescript
async getTranscriptionProjects() {
  try {
    // Try enhanced service first
    return await this.enhancedTranscription.getTranscriptionProjects();
  } catch (error) {
    // Fallback to original implementation
    console.warn('Enhanced transcription failed, using fallback:', error);
    return await this.originalGetTranscriptionProjects();
  }
}

// Keep original as fallback
private async originalGetTranscriptionProjects() {
  // Move existing getTranscriptionProjects code here
  // ... existing implementation ...
}
```

#### Replace `retryTranscriptionJob()`:

```typescript
async retryTranscriptionJob(jobId: string) {
  try {
    // Try enhanced service first
    return await this.enhancedTranscription.retryTranscriptionJob(jobId);
  } catch (error) {
    // Fallback to original implementation
    console.warn('Enhanced retry failed, using fallback:', error);
    return await this.originalRetryTranscriptionJob(jobId);
  }
}

// Keep original as fallback
private async originalRetryTranscriptionJob(jobId: string) {
  // Move existing retryTranscriptionJob code here
  // ... existing implementation ...
}
```

#### Replace `getTranscriptionJob()`:

```typescript
async getTranscriptionJob(jobId: string) {
  try {
    // Try enhanced service first
    return await this.enhancedTranscription.getTranscriptionJob(jobId);
  } catch (error) {
    // Fallback to original implementation
    console.warn('Enhanced job lookup failed, using fallback:', error);
    return await this.originalGetTranscriptionJob(jobId);
  }
}

// Keep original as fallback
private async originalGetTranscriptionJob(jobId: string) {
  // Move existing getTranscriptionJob code here
  // ... existing implementation ...
}
```

### Step 4: Initialize Enhanced Service

Add initialization to the constructor or a startup method:

```typescript
constructor() {
  // ... existing constructor code ...
  
  // Initialize enhanced transcription service
  this.enhancedTranscription.initialize().catch(error => {
    console.warn('Enhanced transcription service failed to initialize:', error);
  });
}
```

## Benefits of This Approach

### ✅ Zero Breaking Changes
- All existing routes continue to work exactly the same
- Dashboard continues to function without modifications
- API responses maintain the same format

### ✅ Graceful Fallback
- If enhanced service fails, falls back to original implementation
- No service interruption during deployment or issues
- Gradual migration possible

### ✅ Enhanced Reliability
- BullMQ for robust job queuing and retry logic
- Real Whisper integration instead of mock processing
- Comprehensive error handling and logging
- Progress tracking and monitoring

## Testing the Integration

### 1. Verify Background Services
```bash
ssh nbost@100.77.230.53 'systemctl status transcription-palantir'
```

### 2. Test API Endpoints
```bash
# Test projects endpoint
curl http://100.77.230.53:3000/transcription/projects

# Test job retry
curl -X POST http://100.77.230.53:3000/transcription/retry/some-job-id

# Test job details
curl http://100.77.230.53:3000/transcription/job/some-job-id
```

### 3. Monitor Logs
```bash
# Enhanced service logs
ssh nbost@100.77.230.53 'tail -f /home/nbost/transcription-palantir/logs/background-services.log'

# Unified API logs
ssh nbost@100.77.230.53 'tail -f /home/nbost/mithrandir-unified-api/logs/api.log'
```

## Rollback Plan

If issues occur, you can quickly rollback by:

1. **Comment out enhanced service calls**:
   ```typescript
   async getTranscriptionProjects() {
     // return await this.enhancedTranscription.getTranscriptionProjects();
     return await this.originalGetTranscriptionProjects();
   }
   ```

2. **Stop background services**:
   ```bash
   ssh nbost@100.77.230.53 'sudo systemctl stop transcription-palantir'
   ```

3. **Restart unified API**:
   ```bash
   ssh nbost@100.77.230.53 'sudo systemctl restart mithrandir-api'
   ```

## Monitoring and Maintenance

### Health Checks
- Background services: `systemctl status transcription-palantir`
- Redis: `systemctl status redis-server`
- Queue status: Check logs for job processing

### Performance Monitoring
- Job processing times in logs
- Queue size and worker utilization
- Memory and CPU usage of background services

### Maintenance Tasks
- Log rotation for background services
- Periodic cleanup of completed jobs
- Monitor disk usage in output directories

## Support

If you encounter issues:

1. Check background service logs
2. Verify Redis is running
3. Ensure file permissions are correct
4. Test with sample audio files
5. Use fallback methods if needed

The enhanced system is designed to be robust and self-healing, with comprehensive logging to help diagnose any issues.
