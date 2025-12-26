#!/usr/bin/env node

/**
 * 🔍 Comprehensive Stuck Job Monitor
 * 
 * This script monitors for actually stuck transcription processes using multiple detection methods:
 * 1. File growth monitoring (output files not growing)
 * 2. Process monitoring (whisper processes running too long)
 * 3. Progress timeout detection (job progress not updating)
 * 4. BullMQ stalled job detection (built-in)
 */

import { Queue } from 'bullmq';
import Redis from 'ioredis';
import fs from 'fs';
import { execSync } from 'child_process';

class StuckJobMonitor {
  constructor() {
    this.redis = new Redis({ host: 'localhost', port: 6379 });
    this.queue = new Queue('transcription', { connection: this.redis });
    
    // Monitoring state
    this.fileWatches = new Map(); // jobId -> { path, lastSize, lastCheck }
    this.processWatches = new Map(); // jobId -> { pid, startTime }
    this.progressWatches = new Map(); // jobId -> { lastProgress, lastUpdate }
    
    // Configuration
    this.config = {
      fileGrowthTimeout: 5 * 60 * 1000, // 5 minutes without file growth
      processTimeout: 30 * 60 * 1000, // 30 minutes max process time
      progressTimeout: 10 * 60 * 1000, // 10 minutes without progress update
      checkInterval: 30 * 1000, // Check every 30 seconds
      minFileGrowth: 100, // Minimum bytes growth to consider "active"
    };
    
    this.stuckJobs = new Set();
    this.alerts = [];
  }

  async start() {
    console.log('🔍 Starting Comprehensive Stuck Job Monitor...');
    console.log('================================================');
    console.log(`📊 Configuration:`);
    console.log(`   File growth timeout: ${this.config.fileGrowthTimeout / 1000}s`);
    console.log(`   Process timeout: ${this.config.processTimeout / 1000}s`);
    console.log(`   Progress timeout: ${this.config.progressTimeout / 1000}s`);
    console.log(`   Check interval: ${this.config.checkInterval / 1000}s`);
    console.log('');

    // Start monitoring loop
    setInterval(() => this.monitorLoop(), this.config.checkInterval);
    
    // Initial check
    await this.monitorLoop();
    
    console.log('✅ Monitor started. Press Ctrl+C to stop.');
  }

  async monitorLoop() {
    try {
      const timestamp = new Date().toISOString();
      console.log(`\n🔍 [${timestamp}] Running stuck job detection...`);
      
      // Get active jobs from BullMQ
      const activeJobs = await this.queue.getJobs(['active'], 0, 100);
      console.log(`📊 Found ${activeJobs.length} active jobs`);
      
      if (activeJobs.length === 0) {
        console.log('✅ No active jobs to monitor');
        return;
      }
      
      // Check each active job
      for (const job of activeJobs) {
        await this.checkJob(job);
      }
      
      // Report findings
      await this.reportFindings();
      
    } catch (error) {
      console.error('❌ Monitor error:', error.message);
    }
  }

  async checkJob(job) {
    const jobId = job.id;
    const jobData = job.data;
    
    console.log(`   🔍 Checking job ${jobId}: ${jobData.fileName}`);
    
    // 1. Check file growth
    await this.checkFileGrowth(job);
    
    // 2. Check process status
    await this.checkProcessStatus(job);
    
    // 3. Check progress updates
    await this.checkProgressUpdates(job);
    
    // 4. Check BullMQ stalled detection
    await this.checkBullMQStalled(job);
  }

  async checkFileGrowth(job) {
    const jobId = job.id;
    const jobData = job.data;
    
    // Determine expected output file path
    const outputPath = this.getExpectedOutputPath(jobData);
    
    if (!outputPath || !fs.existsSync(outputPath)) {
      // No output file yet, or file doesn't exist - this is normal for new jobs
      return;
    }
    
    try {
      const stats = fs.statSync(outputPath);
      const currentSize = stats.size;
      const now = Date.now();
      
      const watch = this.fileWatches.get(jobId);
      
      if (!watch) {
        // First time seeing this file
        this.fileWatches.set(jobId, {
          path: outputPath,
          lastSize: currentSize,
          lastCheck: now,
          lastGrowth: now
        });
        console.log(`     📁 Started monitoring file: ${outputPath} (${currentSize} bytes)`);
        return;
      }
      
      // Check if file has grown
      const sizeGrowth = currentSize - watch.lastSize;
      const timeSinceLastGrowth = now - watch.lastGrowth;
      
      if (sizeGrowth >= this.config.minFileGrowth) {
        // File is growing - update watch
        watch.lastSize = currentSize;
        watch.lastGrowth = now;
        watch.lastCheck = now;
        console.log(`     📈 File growing: +${sizeGrowth} bytes (${currentSize} total)`);
      } else {
        // File not growing - check timeout
        watch.lastCheck = now;
        
        if (timeSinceLastGrowth > this.config.fileGrowthTimeout) {
          this.addAlert('FILE_GROWTH_STUCK', jobId, {
            message: `Output file hasn't grown in ${Math.round(timeSinceLastGrowth / 1000)}s`,
            outputPath,
            currentSize,
            timeSinceGrowth: timeSinceLastGrowth
          });
        } else {
          console.log(`     ⏳ File stable: ${currentSize} bytes (${Math.round(timeSinceLastGrowth / 1000)}s since growth)`);
        }
      }
      
    } catch (error) {
      console.log(`     ❌ File check error: ${error.message}`);
    }
  }

  async checkProcessStatus(job) {
    const jobId = job.id;
    
    try {
      // Look for whisper processes
      const processes = execSync('ps aux | grep -E "(whisper|faster-whisper)" | grep -v grep', { encoding: 'utf8' }).trim();
      
      if (!processes) {
        console.log(`     🔍 No whisper processes found for job ${jobId}`);
        return;
      }
      
      // Parse process info (simplified - would need more robust parsing for production)
      const processLines = processes.split('\n');
      
      for (const line of processLines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 11) continue;
        
        const pid = parts[1];
        const cpu = parseFloat(parts[2]);
        const mem = parseFloat(parts[3]);
        const time = parts[9]; // Process time
        
        // Check if process is consuming resources
        if (cpu < 1.0 && mem > 0) {
          // Low CPU but using memory - potentially stuck
          console.log(`     ⚠️ Low CPU process: PID ${pid}, CPU ${cpu}%, MEM ${mem}%`);
          
          this.addAlert('PROCESS_LOW_CPU', jobId, {
            message: `Process ${pid} using low CPU (${cpu}%) but consuming memory`,
            pid,
            cpu,
            memory: mem,
            time
          });
        } else {
          console.log(`     ✅ Active process: PID ${pid}, CPU ${cpu}%, MEM ${mem}%`);
        }
      }
      
    } catch (error) {
      // No processes found or error - this might be normal
      console.log(`     🔍 Process check: ${error.message}`);
    }
  }

  async checkProgressUpdates(job) {
    const jobId = job.id;
    const currentProgress = job.progress;
    const now = Date.now();
    
    const watch = this.progressWatches.get(jobId);
    
    if (!watch) {
      // First time seeing this job
      this.progressWatches.set(jobId, {
        lastProgress: currentProgress,
        lastUpdate: now
      });
      console.log(`     📊 Started monitoring progress: ${currentProgress}%`);
      return;
    }
    
    // Check if progress has updated
    if (currentProgress !== watch.lastProgress) {
      // Progress updated
      watch.lastProgress = currentProgress;
      watch.lastUpdate = now;
      console.log(`     📈 Progress updated: ${currentProgress}%`);
    } else {
      // Progress hasn't changed - check timeout
      const timeSinceUpdate = now - watch.lastUpdate;
      
      if (timeSinceUpdate > this.config.progressTimeout) {
        this.addAlert('PROGRESS_STUCK', jobId, {
          message: `Progress stuck at ${currentProgress}% for ${Math.round(timeSinceUpdate / 1000)}s`,
          currentProgress,
          timeSinceUpdate
        });
      } else {
        console.log(`     ⏳ Progress stable: ${currentProgress}% (${Math.round(timeSinceUpdate / 1000)}s)`);
      }
    }
  }

  async checkBullMQStalled(job) {
    // BullMQ has built-in stalled detection
    // We can check if the job is marked as stalled
    const jobId = job.id;
    
    try {
      const jobState = await job.getState();
      
      if (jobState === 'stalled') {
        this.addAlert('BULLMQ_STALLED', jobId, {
          message: 'Job marked as stalled by BullMQ',
          state: jobState
        });
      }
      
    } catch (error) {
      console.log(`     ❌ BullMQ state check error: ${error.message}`);
    }
  }

  getExpectedOutputPath(jobData) {
    if (!jobData.fileName) return null;

    // Try multiple possible output paths
    const baseName = jobData.fileName.replace(/\.[^.]+$/, '');

    const possiblePaths = [
      `/mnt/data/whisper-batch/output/${baseName}.txt`,
      `/mnt/data/whisper-batch/output/${baseName}.json`,
      `/mnt/data/whisper-batch/temp/${baseName}.txt`,
      `/mnt/data/whisper-batch/temp/${baseName}.json`,
    ];

    for (const path of possiblePaths) {
      if (fs.existsSync(path)) {
        return path;
      }
    }

    return null;
  }

  addAlert(type, jobId, details) {
    const alertKey = `${type}-${jobId}`;

    // Avoid duplicate alerts
    if (this.stuckJobs.has(alertKey)) {
      return;
    }

    this.stuckJobs.add(alertKey);

    const alert = {
      type,
      jobId,
      timestamp: new Date().toISOString(),
      ...details
    };

    this.alerts.push(alert);

    console.log(`     🚨 ALERT [${type}]: ${details.message}`);
  }

  async reportFindings() {
    if (this.alerts.length === 0) {
      console.log('✅ No stuck jobs detected');
      return;
    }

    console.log(`\n🚨 STUCK JOB ALERTS (${this.alerts.length}):`);
    console.log('=' .repeat(50));

    // Group alerts by type
    const alertsByType = {};
    for (const alert of this.alerts) {
      if (!alertsByType[alert.type]) {
        alertsByType[alert.type] = [];
      }
      alertsByType[alert.type].push(alert);
    }

    // Report each type
    for (const [type, alerts] of Object.entries(alertsByType)) {
      console.log(`\n🔴 ${type} (${alerts.length} jobs):`);

      for (const alert of alerts) {
        console.log(`   Job ${alert.jobId}: ${alert.message}`);

        // Suggest actions based on alert type
        switch (type) {
          case 'FILE_GROWTH_STUCK':
            console.log(`     💡 Action: Check if whisper process is running, restart job if needed`);
            break;
          case 'PROCESS_LOW_CPU':
            console.log(`     💡 Action: Process may be waiting for I/O, check system resources`);
            break;
          case 'PROGRESS_STUCK':
            console.log(`     💡 Action: Job progress not updating, may need restart`);
            break;
          case 'BULLMQ_STALLED':
            console.log(`     💡 Action: BullMQ detected stall, job will be auto-retried`);
            break;
        }
      }
    }

    console.log(`\n📋 Summary:`);
    console.log(`   Total alerts: ${this.alerts.length}`);
    console.log(`   Unique jobs affected: ${new Set(this.alerts.map(a => a.jobId)).size}`);

    // Save alerts to file
    const alertsFile = `/mnt/data/whisper-batch/logs/stuck-job-alerts-${Date.now()}.json`;
    try {
      fs.writeFileSync(alertsFile, JSON.stringify(this.alerts, null, 2));
      console.log(`   Alerts saved to: ${alertsFile}`);
    } catch (error) {
      console.log(`   ❌ Failed to save alerts: ${error.message}`);
    }

    // Clear alerts for next cycle
    this.alerts = [];
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up monitor...');
    await this.redis.disconnect();
    console.log('✅ Monitor stopped');
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down...');
  if (global.monitor) {
    await global.monitor.cleanup();
  }
  process.exit(0);
});

// Start monitor
if (import.meta.main) {
  const monitor = new StuckJobMonitor();
  global.monitor = monitor; // For cleanup

  monitor.start().catch(error => {
    console.error('❌ Monitor failed to start:', error);
    process.exit(1);
  });
}
