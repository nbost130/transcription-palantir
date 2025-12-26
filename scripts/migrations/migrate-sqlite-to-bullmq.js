#!/usr/bin/env node

/**
 * 🔄 Migrate SQLite Jobs to BullMQ
 * 
 * This script migrates failed and retryable jobs from SQLite to BullMQ
 * and exports job history for reference
 */

import fs from 'fs';
import { execSync } from 'child_process';

const BACKUP_DB = '/mnt/data/whisper-batch/jobs.db.backup.20251121';
const EXPORT_DIR = '/mnt/data/whisper-batch/migration-exports';

class SQLiteToBullMQMigrator {
  constructor() {
    this.stats = {
      totalJobs: 0,
      completed: 0,
      failed: 0,
      processing: 0,
      retryable: 0,
      skipped: 0
    };
  }

  async migrate() {
    try {
      console.log('🔄 Starting SQLite to BullMQ migration...');
      
      // Create export directory
      execSync(`mkdir -p ${EXPORT_DIR}`, { stdio: 'inherit' });
      
      // 1. Export all job data for reference
      await this.exportJobHistory();
      
      // 2. Analyze failed jobs
      await this.analyzeFailedJobs();
      
      // 3. Migrate retryable jobs to BullMQ
      await this.migrateRetryableJobs();
      
      // 4. Generate migration report
      await this.generateReport();
      
      console.log('✅ Migration completed successfully!');
      
    } catch (error) {
      console.error('❌ Migration failed:', error.message);
      throw error;
    }
  }

  async exportJobHistory() {
    console.log('📁 Exporting job history...');
    
    // Export all jobs to JSON
    const allJobsQuery = `
      SELECT id, fileName, filePath, fileSize, status, attempts, maxAttempts,
             createdAt, startedAt, completedAt, error, outputPath
      FROM jobs 
      ORDER BY createdAt DESC
    `;
    
    const result = execSync(`sqlite3 -json ${BACKUP_DB} "${allJobsQuery}"`, { encoding: 'utf8' });
    const allJobs = JSON.parse(result);
    
    // Write to export file
    const exportFile = `${EXPORT_DIR}/all-jobs-history.json`;
    fs.writeFileSync(exportFile, JSON.stringify(allJobs, null, 2));
    
    this.stats.totalJobs = allJobs.length;
    console.log(`✅ Exported ${allJobs.length} jobs to ${exportFile}`);
    
    return allJobs;
  }

  async analyzeFailedJobs() {
    console.log('🔍 Analyzing failed jobs...');
    
    // Get failed job analysis
    const failedAnalysisQuery = `
      SELECT error, COUNT(*) as count, 
             MIN(createdAt) as earliest, 
             MAX(createdAt) as latest
      FROM jobs 
      WHERE status = 'failed' 
      GROUP BY error 
      ORDER BY count DESC
    `;
    
    const result = execSync(`sqlite3 -json ${BACKUP_DB} "${failedAnalysisQuery}"`, { encoding: 'utf8' });
    const failedAnalysis = JSON.parse(result);
    
    // Write analysis to file
    const analysisFile = `${EXPORT_DIR}/failed-jobs-analysis.json`;
    fs.writeFileSync(analysisFile, JSON.stringify(failedAnalysis, null, 2));
    
    console.log(`✅ Failed job analysis saved to ${analysisFile}`);
    
    // Count retryable jobs (recent failures with "Unknown error")
    const retryableQuery = `
      SELECT COUNT(*) as count
      FROM jobs 
      WHERE status = 'failed' 
      AND error = 'Unknown error'
      AND createdAt > datetime('now', '-7 days')
    `;
    
    const retryableResult = execSync(`sqlite3 -json ${BACKUP_DB} "${retryableQuery}"`, { encoding: 'utf8' });
    const retryableCount = JSON.parse(retryableResult)[0].count;
    
    this.stats.retryable = retryableCount;
    console.log(`📊 Found ${retryableCount} retryable jobs (recent "Unknown error" failures)`);
    
    return failedAnalysis;
  }

  async migrateRetryableJobs() {
    console.log('🔄 Migrating retryable jobs to BullMQ...');
    
    // Get retryable jobs (recent failures with "Unknown error")
    const retryableQuery = `
      SELECT id, fileName, filePath, fileSize, createdAt, error
      FROM jobs 
      WHERE status = 'failed' 
      AND error = 'Unknown error'
      AND createdAt > datetime('now', '-7 days')
      ORDER BY createdAt DESC
    `;
    
    const result = execSync(`sqlite3 -json ${BACKUP_DB} "${retryableQuery}"`, { encoding: 'utf8' });
    const retryableJobs = JSON.parse(result);
    
    if (retryableJobs.length === 0) {
      console.log('ℹ️ No retryable jobs found');
      return;
    }
    
    // Export retryable jobs for manual review
    const retryableFile = `${EXPORT_DIR}/retryable-jobs.json`;
    fs.writeFileSync(retryableFile, JSON.stringify(retryableJobs, null, 2));
    
    console.log(`📁 Exported ${retryableJobs.length} retryable jobs to ${retryableFile}`);
    console.log('ℹ️ These jobs can be manually added to BullMQ if needed');
    
    // Create a script to add them to BullMQ
    const addScript = this.generateBullMQAddScript(retryableJobs);
    const scriptFile = `${EXPORT_DIR}/add-retryable-jobs-to-bullmq.js`;
    fs.writeFileSync(scriptFile, addScript);
    
    console.log(`📜 Created BullMQ add script: ${scriptFile}`);
    console.log('   Run this script to add retryable jobs to BullMQ queue');
    
    return retryableJobs;
  }

  generateBullMQAddScript(retryableJobs) {
    return `#!/usr/bin/env node

/**
 * 🔄 Add Retryable Jobs to BullMQ
 *
 * This script adds the retryable jobs from SQLite to the BullMQ queue
 * Generated automatically by the migration script
 */

import { Queue } from 'bullmq';
import Redis from 'ioredis';

const redis = new Redis({ host: 'localhost', port: 6379 });
const queue = new Queue('transcription', { connection: redis });

const retryableJobs = ${JSON.stringify(retryableJobs, null, 2)};

async function addJobsToBullMQ() {
  console.log('🔄 Adding \${retryableJobs.length} retryable jobs to BullMQ...');

  let added = 0;
  let skipped = 0;

  for (const job of retryableJobs) {
    try {
      // Check if file still exists
      const fs = await import('fs');
      if (!fs.existsSync(job.filePath)) {
        console.log(\`⏭️ Skipping \${job.fileName} - file not found\`);
        skipped++;
        continue;
      }

      // Add job to BullMQ
      await queue.add('transcribe', {
        id: job.id,
        fileName: job.fileName,
        filePath: job.filePath,
        fileSize: job.fileSize,
        status: 'pending',
        priority: 1, // Normal priority
        progress: 0,
        attempts: 0,
        maxAttempts: 3,
        metadata: {
          originalPath: job.filePath,
          migratedFromSQLite: true,
          originalCreatedAt: job.createdAt,
          originalError: job.error
        }
      }, {
        priority: 1,
        jobId: job.id
      });

      console.log(\`✅ Added \${job.fileName}\`);
      added++;

    } catch (error) {
      console.error(\`❌ Failed to add \${job.fileName}:\`, error.message);
      skipped++;
    }
  }

  console.log(\`\\n📊 Migration Summary:\`);
  console.log(\`   Added: \${added}\`);
  console.log(\`   Skipped: \${skipped}\`);
  console.log(\`   Total: \${retryableJobs.length}\`);

  await redis.disconnect();
}

addJobsToBullMQ().catch(console.error);
`;
  }

  async generateReport() {
    console.log('📊 Generating migration report...');

    // Get final stats
    const statsQuery = `
      SELECT status, COUNT(*) as count
      FROM jobs
      GROUP BY status
    `;

    const result = execSync(`sqlite3 -json ${BACKUP_DB} "${statsQuery}"`, { encoding: 'utf8' });
    const statusCounts = JSON.parse(result);

    statusCounts.forEach(stat => {
      this.stats[stat.status] = stat.count;
    });

    const report = {
      migrationDate: new Date().toISOString(),
      sourceDatabase: BACKUP_DB,
      exportDirectory: EXPORT_DIR,
      statistics: this.stats,
      recommendations: [
        `Review ${EXPORT_DIR}/failed-jobs-analysis.json for failure patterns`,
        `Consider running ${EXPORT_DIR}/add-retryable-jobs-to-bullmq.js to retry failed jobs`,
        `Keep ${EXPORT_DIR}/all-jobs-history.json as historical reference`,
        'Monitor BullMQ for any issues with migrated jobs'
      ]
    };

    const reportFile = `${EXPORT_DIR}/migration-report.json`;
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

    console.log(`\n📋 Migration Report:`);
    console.log(`   Total jobs: ${this.stats.totalJobs}`);
    console.log(`   Completed: ${this.stats.completed}`);
    console.log(`   Failed: ${this.stats.failed}`);
    console.log(`   Retryable: ${this.stats.retryable}`);
    console.log(`\n📁 Files created:`);
    console.log(`   - ${EXPORT_DIR}/all-jobs-history.json`);
    console.log(`   - ${EXPORT_DIR}/failed-jobs-analysis.json`);
    console.log(`   - ${EXPORT_DIR}/retryable-jobs.json`);
    console.log(`   - ${EXPORT_DIR}/add-retryable-jobs-to-bullmq.js`);
    console.log(`   - ${reportFile}`);

    return report;
  }
}

// Run migration
if (import.meta.main) {
  const migrator = new SQLiteToBullMQMigrator();
  migrator.migrate().catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
}
