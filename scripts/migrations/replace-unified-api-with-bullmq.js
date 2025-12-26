#!/usr/bin/env node

/**
 * 🔄 Replace Unified API with BullMQ Direct Access
 * 
 * This script replaces the SQLite-based unified API with direct BullMQ queries
 * Eliminates the need for SQLite database and data synchronization
 */

import fs from 'fs';

const SERVER_FILE = '/home/nbost/unified-api-enhanced/dist/services.js';

function replaceWithBullMQService() {
  try {
    console.log('🔄 Replacing unified API with direct BullMQ access...');
    
    // Read the current services.js file
    let content = fs.readFileSync(SERVER_FILE, 'utf8');
    
    // Replace the entire getTranscriptionDashboard method with BullMQ direct access
    const oldDashboardMethod = /async getTranscriptionDashboard\(\) \{[\s\S]*?\n    \}/;
    
    const newDashboardMethod = `async getTranscriptionDashboard() {
        try {
            // Connect to Redis and get BullMQ data directly
            const Redis = require('ioredis');
            const { Queue } = require('bullmq');
            
            const redis = new Redis({
                host: 'localhost',
                port: 6379,
                maxRetriesPerRequest: 3,
                retryDelayOnFailover: 100,
            });
            
            const queue = new Queue('transcription', { connection: redis });
            
            // Get all jobs from BullMQ
            const [waiting, active, completed, failed] = await Promise.all([
                queue.getJobs(['waiting'], 0, 1000),
                queue.getJobs(['active'], 0, 100),
                queue.getJobs(['completed'], 0, 1000),
                queue.getJobs(['failed'], 0, 1000),
            ]);
            
            const allJobs = [...waiting, ...active, ...completed, ...failed];
            console.log('DEBUG: Retrieved', allJobs.length, 'jobs from BullMQ');
            
            // Map BullMQ jobs to dashboard format
            const dashboardJobs = allJobs.map(job => this.mapBullMQJobToDashboard(job));
            
            // Separate recent jobs and Orbis jobs
            const recentJobs = dashboardJobs;
            const orbisJobs = dashboardJobs.filter(job => 
                job.filePath?.includes('Orbis') || 
                job.fileName?.includes('LESSON') || 
                job.fileName?.includes('Orbis')
            );
            
            await redis.disconnect();
            
            return { recentJobs, orbisJobs };
            
        } catch (error) {
            console.log('DEBUG: getTranscriptionDashboard error:', error.message);
            return { recentJobs: [], orbisJobs: [] };
        }
    }`;
    
    // Add the BullMQ job mapping method
    const mappingMethod = `
    mapBullMQJobToDashboard(job) {
        const now = Date.now();
        const createdAt = job.timestamp || now;
        const startedAt = job.processedOn;
        const completedAt = job.finishedOn;

        // Calculate elapsed time
        const elapsedSeconds = Math.floor((now - createdAt) / 1000);
        const processingSeconds = startedAt ? Math.floor((now - startedAt) / 1000) : null;

        // Format durations
        const formatDuration = (seconds) => {
            if (!seconds || seconds < 0) return null;
            if (seconds < 60) return \`\${seconds}s\`;
            if (seconds < 3600) return \`\${Math.floor(seconds / 60)}m \${seconds % 60}s\`;
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;
            return \`\${hours}h \${minutes}m \${secs}s\`;
        };

        // Map BullMQ status to dashboard status
        let status = 'pending';
        if (job.finishedOn) {
            status = job.failedReason ? 'failed' : 'completed';
        } else if (job.processedOn && !job.finishedOn) {
            status = 'processing';
        }

        return {
            id: job.id,
            fileName: job.data?.fileName || 'Unknown',
            filePath: job.data?.filePath || '',
            fileSize: job.data?.fileSize || 0,
            status,
            createdAt: new Date(createdAt).toISOString(),
            startedAt: startedAt ? new Date(startedAt).toISOString() : null,
            completedAt: completedAt ? new Date(completedAt).toISOString() : null,
            error: job.failedReason || null,
            outputPath: job.returnvalue?.transcriptPath || null,
            elapsedSeconds,
            elapsedFormatted: formatDuration(elapsedSeconds),
            processingSeconds,
            processingFormatted: formatDuration(processingSeconds)
        };
    }`;

    // Apply the replacements
    if (oldDashboardMethod.test(content)) {
      content = content.replace(oldDashboardMethod, newDashboardMethod);
      console.log('✅ Replaced getTranscriptionDashboard method');

      // Add the mapping method before the last closing brace
      const lastBraceIndex = content.lastIndexOf('}');
      content = content.slice(0, lastBraceIndex) + mappingMethod + '\n' + content.slice(lastBraceIndex);
      console.log('✅ Added BullMQ job mapping method');
    } else {
      console.log('❌ Could not find getTranscriptionDashboard method pattern');
      return false;
    }
    
    // Remove SQLite-based retry method
    const oldRetryMethod = /async retryTranscriptionJob\(jobId\) \{[\s\S]*?\n    \}/;
    if (oldRetryMethod.test(content)) {
      const newRetryMethod = `async retryTranscriptionJob(jobId) {
        try {
            // Use BullMQ to retry the job
            const Redis = require('ioredis');
            const { Queue } = require('bullmq');

            const redis = new Redis({ host: 'localhost', port: 6379 });
            const queue = new Queue('transcription', { connection: redis });

            const job = await queue.getJob(jobId);
            if (!job) {
                await redis.disconnect();
                return { status: 'error', message: 'Job not found', jobId };
            }

            await job.retry();
            await redis.disconnect();

            return { status: 'success', message: 'Job retried successfully', jobId };
        } catch (error) {
            return { status: 'error', message: error.message, jobId };
        }
    }`;

      content = content.replace(oldRetryMethod, newRetryMethod);
      console.log('✅ Replaced retryTranscriptionJob method');
    }

    // Remove SQLite-based job details method
    const oldDetailsMethod = /async getTranscriptionJobDetails\(jobId\) \{[\s\S]*?\n    \}/;
    if (oldDetailsMethod.test(content)) {
      const newDetailsMethod = `async getTranscriptionJobDetails(jobId) {
        try {
            const Redis = require('ioredis');
            const { Queue } = require('bullmq');

            const redis = new Redis({ host: 'localhost', port: 6379 });
            const queue = new Queue('transcription', { connection: redis });

            const job = await queue.getJob(jobId);
            if (!job) {
                await redis.disconnect();
                return { error: 'Job not found' };
            }

            const jobDetails = this.mapBullMQJobToDashboard(job);
            await redis.disconnect();

            return { ...jobDetails, timestamp: new Date().toISOString() };
        } catch (error) {
            return { error: error.message };
        }
    }`;

      content = content.replace(oldDetailsMethod, newDetailsMethod);
      console.log('✅ Replaced getTranscriptionJobDetails method');
    }

    // Write the updated file
    fs.writeFileSync(SERVER_FILE, content);
    console.log('✅ Successfully replaced unified API with BullMQ direct access!');

    return true;
    
  } catch (error) {
    console.error('❌ Error replacing unified API:', error.message);
    return false;
  }
}

// Run the replacement
const success = replaceWithBullMQService();
process.exit(success ? 0 : 1);
