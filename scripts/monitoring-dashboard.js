#!/usr/bin/env node

/**
 * 📊 Transcription Monitoring Dashboard
 * 
 * Real-time monitoring dashboard that combines multiple detection methods
 */

import { Queue } from 'bullmq';
import Redis from 'ioredis';
import fs from 'fs';
import { execSync } from 'child_process';

class MonitoringDashboard {
  constructor() {
    this.redis = new Redis({ host: 'localhost', port: 6379 });
    this.queue = new Queue('transcription', { connection: this.redis });
  }

  async getSystemStatus() {
    const status = {
      timestamp: new Date().toISOString(),
      queue: await this.getQueueStatus(),
      processes: await this.getProcessStatus(),
      files: await this.getFileStatus(),
      health: { overall: 'unknown', issues: [] }
    };

    // Determine overall health
    status.health = this.calculateOverallHealth(status);
    
    return status;
  }

  async getQueueStatus() {
    try {
      const [waiting, active, completed, failed, stalled] = await Promise.all([
        this.queue.getJobs(['waiting'], 0, 1000),
        this.queue.getJobs(['active'], 0, 100),
        this.queue.getJobs(['completed'], 0, 100),
        this.queue.getJobs(['failed'], 0, 100),
        this.queue.getJobs(['stalled'], 0, 100),
      ]);

      const activeJobDetails = await Promise.all(
        active.map(async (job) => {
          const progress = job.progress || 0;
          const startTime = job.processedOn || job.timestamp;
          const runningTime = startTime ? Date.now() - startTime : 0;
          
          return {
            id: job.id,
            fileName: job.data?.fileName || 'Unknown',
            progress,
            runningTime,
            runningTimeFormatted: this.formatDuration(runningTime),
            status: runningTime > 30 * 60 * 1000 ? 'potentially_stuck' : 'normal'
          };
        })
      );

      return {
        counts: {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          stalled: stalled.length
        },
        activeJobs: activeJobDetails,
        stalledJobs: stalled.map(job => ({
          id: job.id,
          fileName: job.data?.fileName || 'Unknown',
          stalledAt: job.finishedOn || 'Unknown'
        }))
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async getProcessStatus() {
    try {
      const processes = execSync('ps aux | grep -E "(whisper|faster-whisper)" | grep -v grep', { encoding: 'utf8' }).trim();
      
      if (!processes) {
        return { count: 0, processes: [] };
      }

      const processLines = processes.split('\n');
      const processDetails = processLines.map(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 11) return null;

        const pid = parts[1];
        const cpu = parseFloat(parts[2]);
        const mem = parseFloat(parts[3]);
        const time = parts[9];
        const command = parts.slice(10).join(' ');

        return {
          pid,
          cpu,
          memory: mem,
          time,
          command: command.substring(0, 100) + (command.length > 100 ? '...' : ''),
          status: cpu < 1.0 ? 'low_cpu' : 'active'
        };
      }).filter(Boolean);

      return {
        count: processDetails.length,
        processes: processDetails
      };
    } catch (error) {
      return { count: 0, processes: [], error: error.message };
    }
  }

  async getFileStatus() {
    try {
      const outputDir = '/mnt/data/whisper-batch/output';
      const tempDir = '/mnt/data/whisper-batch/temp';
      
      // Find recent output files
      const recentFiles = [];
      
      for (const dir of [outputDir, tempDir]) {
        if (!fs.existsSync(dir)) continue;
        
        const files = fs.readdirSync(dir)
          .filter(f => f.endsWith('.txt') || f.endsWith('.json'))
          .map(f => {
            const filePath = `${dir}/${f}`;
            const stats = fs.statSync(filePath);
            const ageMs = Date.now() - stats.mtime.getTime();
            
            return {
              name: f,
              path: filePath,
              size: stats.size,
              lastModified: stats.mtime.toISOString(),
              ageMs,
              ageFormatted: this.formatDuration(ageMs),
              isRecent: ageMs < 30 * 60 * 1000 // Last 30 minutes
            };
          })
          .filter(f => f.isRecent)
          .sort((a, b) => a.ageMs - b.ageMs);
        
        recentFiles.push(...files);
      }

      return {
        recentFiles: recentFiles.slice(0, 10), // Show last 10
        totalRecentFiles: recentFiles.length
      };
    } catch (error) {
      return { recentFiles: [], totalRecentFiles: 0, error: error.message };
    }
  }

  calculateOverallHealth(status) {
    const issues = [];
    let healthScore = 100;

    // Check for stalled jobs
    if (status.queue.counts?.stalled > 0) {
      issues.push(`${status.queue.counts.stalled} stalled jobs`);
      healthScore -= 20;
    }

    // Check for long-running jobs
    const longRunningJobs = status.queue.activeJobs?.filter(job => job.status === 'potentially_stuck') || [];
    if (longRunningJobs.length > 0) {
      issues.push(`${longRunningJobs.length} potentially stuck jobs`);
      healthScore -= 15;
    }

    // Check for low CPU processes
    const lowCpuProcesses = status.processes.processes?.filter(p => p.status === 'low_cpu') || [];
    if (lowCpuProcesses.length > 0) {
      issues.push(`${lowCpuProcesses.length} low CPU processes`);
      healthScore -= 10;
    }

    // Check for queue errors
    if (status.queue.error) {
      issues.push('Queue connection error');
      healthScore -= 30;
    }

    // Determine overall status
    let overall = 'healthy';
    if (healthScore < 70) {
      overall = 'unhealthy';
    } else if (healthScore < 90) {
      overall = 'degraded';
    }

    return {
      overall,
      score: Math.max(0, healthScore),
      issues
    };
  }

  formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }

  async displayDashboard() {
    console.clear();
    
    const status = await this.getSystemStatus();
    
    console.log('🔮 Transcription Palantir - Monitoring Dashboard');
    console.log('='.repeat(60));
    console.log(`⏰ ${status.timestamp}`);
    console.log('');

    // Overall Health
    const healthEmoji = status.health.overall === 'healthy' ? '✅' : 
                       status.health.overall === 'degraded' ? '⚠️' : '❌';
    console.log(`${healthEmoji} Overall Health: ${status.health.overall.toUpperCase()} (${status.health.score}%)`);
    
    if (status.health.issues.length > 0) {
      console.log('🚨 Issues:');
      status.health.issues.forEach(issue => console.log(`   • ${issue}`));
    }
    console.log('');

    // Queue Status
    console.log('📊 Queue Status:');
    if (status.queue.error) {
      console.log(`   ❌ Error: ${status.queue.error}`);
    } else {
      const q = status.queue.counts;
      console.log(`   Waiting: ${q.waiting} | Active: ${q.active} | Completed: ${q.completed} | Failed: ${q.failed}`);
      if (q.stalled > 0) {
        console.log(`   🚨 Stalled: ${q.stalled}`);
      }
    }
    console.log('');

    // Active Jobs
    if (status.queue.activeJobs?.length > 0) {
      console.log('🔄 Active Jobs:');
      status.queue.activeJobs.forEach(job => {
        const statusEmoji = job.status === 'potentially_stuck' ? '🚨' : '✅';
        console.log(`   ${statusEmoji} ${job.fileName} - ${job.progress}% (${job.runningTimeFormatted})`);
      });
      console.log('');
    }

    // Process Status
    console.log(`🖥️ Processes: ${status.processes.count} whisper processes`);
    if (status.processes.processes?.length > 0) {
      status.processes.processes.forEach(proc => {
        const statusEmoji = proc.status === 'low_cpu' ? '⚠️' : '✅';
        console.log(`   ${statusEmoji} PID ${proc.pid}: CPU ${proc.cpu}%, MEM ${proc.memory}%`);
      });
    }
    console.log('');

    // Recent Files
    if (status.files.totalRecentFiles > 0) {
      console.log(`📁 Recent Output Files: ${status.files.totalRecentFiles}`);
      status.files.recentFiles.slice(0, 5).forEach(file => {
        console.log(`   📄 ${file.name} (${file.size} bytes, ${file.ageFormatted} ago)`);
      });
      if (status.files.totalRecentFiles > 5) {
        console.log(`   ... and ${status.files.totalRecentFiles - 5} more`);
      }
    } else {
      console.log('📁 No recent output files');
    }

    console.log('');
    console.log('Press Ctrl+C to stop monitoring');
  }

  async cleanup() {
    await this.redis.disconnect();
  }
}

// Main execution
async function main() {
  const dashboard = new MonitoringDashboard();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down dashboard...');
    await dashboard.cleanup();
    process.exit(0);
  });

  // Check if running in watch mode
  const watchMode = process.argv.includes('--watch') || process.argv.includes('-w');
  const interval = parseInt(process.argv.find(arg => arg.startsWith('--interval='))?.split('=')[1] || '5000');

  if (watchMode) {
    console.log('📊 Starting monitoring dashboard in watch mode...');
    console.log(`🔄 Refresh interval: ${interval / 1000}s`);
    console.log('');

    // Initial display
    await dashboard.displayDashboard();

    // Set up refresh interval
    setInterval(async () => {
      await dashboard.displayDashboard();
    }, interval);

    // Keep the process running
    await new Promise(() => {}); // Run forever until SIGINT
  } else {
    // Single check mode
    await dashboard.displayDashboard();
    await dashboard.cleanup();
  }
}

if (import.meta.main) {
  main().catch(error => {
    console.error('❌ Dashboard error:', error);
    process.exit(1);
  });
}
