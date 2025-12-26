#!/usr/bin/env node

/**
 * 🔄 Recover Failed Transcriptions
 * 
 * This script analyzes failed jobs from SQLite backup and adds them to BullMQ
 * if no transcript exists and the input file is still available
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const BACKUP_DB = '/mnt/data/whisper-batch/jobs.db.backup.20251121';
const RECOVERY_DIR = '/mnt/data/whisper-batch/recovery-analysis';

class TranscriptionRecovery {
  constructor() {
    this.stats = {
      totalFailed: 0,
      inputFileExists: 0,
      inputFileMissing: 0,
      transcriptExists: 0,
      transcriptMissing: 0,
      needsReprocessing: 0,
      addedToBullMQ: 0,
      skipped: 0,
      errors: 0
    };
    
    this.recoveryJobs = [];
    this.analysisResults = [];
  }

  async analyze() {
    try {
      console.log('🔍 Starting failed transcription recovery analysis...');
      
      // Create recovery directory
      execSync(`mkdir -p ${RECOVERY_DIR}`, { stdio: 'inherit' });
      
      // 1. Get all failed jobs
      const failedJobs = await this.getFailedJobs();
      
      // 2. Analyze each failed job
      for (const job of failedJobs) {
        const analysis = await this.analyzeJob(job);
        this.analysisResults.push(analysis);
        
        if (analysis.needsReprocessing) {
          this.recoveryJobs.push(job);
        }
      }
      
      // 3. Generate analysis report
      await this.generateAnalysisReport();
      
      // 4. Create BullMQ recovery script
      await this.createRecoveryScript();
      
      console.log('✅ Recovery analysis completed!');
      this.printSummary();
      
    } catch (error) {
      console.error('❌ Recovery analysis failed:', error.message);
      throw error;
    }
  }

  async getFailedJobs() {
    console.log('📋 Getting failed jobs from SQLite backup...');
    
    const query = `
      SELECT id, fileName, filePath, fileSize, error, createdAt, outputPath
      FROM jobs 
      WHERE status = 'failed'
      ORDER BY createdAt DESC
    `;
    
    const result = execSync(`sqlite3 -json ${BACKUP_DB} "${query}"`, { encoding: 'utf8' });
    const failedJobs = JSON.parse(result);
    
    this.stats.totalFailed = failedJobs.length;
    console.log(`📊 Found ${failedJobs.length} failed jobs`);
    
    return failedJobs;
  }

  async analyzeJob(job) {
    const analysis = {
      id: job.id,
      fileName: job.fileName,
      filePath: job.filePath,
      error: job.error,
      createdAt: job.createdAt,
      inputFileExists: false,
      transcriptExists: false,
      transcriptPath: null,
      needsReprocessing: false,
      reason: ''
    };

    try {
      // Check if input file exists
      if (job.filePath && fs.existsSync(job.filePath)) {
        analysis.inputFileExists = true;
        this.stats.inputFileExists++;
      } else {
        this.stats.inputFileMissing++;
        analysis.reason = 'Input file missing';
        return analysis;
      }

      // Determine expected transcript path
      const transcriptPaths = this.getExpectedTranscriptPaths(job);
      
      // Check if any transcript exists
      for (const transcriptPath of transcriptPaths) {
        if (fs.existsSync(transcriptPath)) {
          analysis.transcriptExists = true;
          analysis.transcriptPath = transcriptPath;
          this.stats.transcriptExists++;
          break;
        }
      }

      if (!analysis.transcriptExists) {
        this.stats.transcriptMissing++;
        
        // Skip if error indicates file issues that won't be resolved
        if (this.isUnrecoverableError(job.error)) {
          analysis.reason = `Unrecoverable error: ${job.error}`;
          this.stats.skipped++;
        } else {
          analysis.needsReprocessing = true;
          analysis.reason = 'No transcript found, input file exists';
          this.stats.needsReprocessing++;
        }
      } else {
        analysis.reason = 'Transcript already exists';
      }

    } catch (error) {
      analysis.reason = `Analysis error: ${error.message}`;
      this.stats.errors++;
    }

    return analysis;
  }

  getExpectedTranscriptPaths(job) {
    const paths = [];
    
    // 1. Check outputPath from job if it exists
    if (job.outputPath) {
      paths.push(job.outputPath);
    }
    
    // 2. Check standard output directory
    const baseName = path.basename(job.fileName, path.extname(job.fileName));
    const standardOutputPath = `/mnt/data/whisper-batch/output/${baseName}.txt`;
    paths.push(standardOutputPath);
    
    // 3. Check completed directory
    const completedPath = `/mnt/data/whisper-batch/completed/${job.fileName}`;
    const completedTranscriptPath = `/mnt/data/whisper-batch/completed/${baseName}.txt`;
    paths.push(completedPath, completedTranscriptPath);
    
    // 4. Check project-based output structure
    if (job.filePath) {
      const relativePath = job.filePath.replace('/mnt/data/whisper-batch/inbox/', '');
      const projectDir = path.dirname(relativePath);
      if (projectDir && projectDir !== '.') {
        const projectOutputPath = `/mnt/data/whisper-batch/output/${projectDir}/${baseName}.txt`;
        paths.push(projectOutputPath);
      }
    }
    
    return [...new Set(paths)]; // Remove duplicates
  }

  isUnrecoverableError(error) {
    const unrecoverablePatterns = [
      /Input file not accessible/i,
      /File not found/i,
      /Permission denied/i,
      /Corrupted file/i,
      /Invalid format/i,
      /Unsupported codec/i
    ];
    
    return unrecoverablePatterns.some(pattern => pattern.test(error || ''));
  }

  async generateAnalysisReport() {
    console.log('📊 Generating recovery analysis report...');

    const report = {
      analysisDate: new Date().toISOString(),
      statistics: this.stats,
      recoveryJobs: this.recoveryJobs.length,
      recommendations: [],
      jobsNeedingReprocessing: this.recoveryJobs.map(job => ({
        id: job.id,
        fileName: job.fileName,
        filePath: job.filePath,
        error: job.error,
        createdAt: job.createdAt
      }))
    };

    // Add recommendations based on analysis
    if (this.stats.needsReprocessing > 0) {
      report.recommendations.push(`${this.stats.needsReprocessing} jobs need reprocessing - run the recovery script`);
    }

    if (this.stats.inputFileMissing > 0) {
      report.recommendations.push(`${this.stats.inputFileMissing} jobs have missing input files - cannot recover`);
    }

    if (this.stats.transcriptExists > 0) {
      report.recommendations.push(`${this.stats.transcriptExists} jobs already have transcripts - no action needed`);
    }

    // Save detailed analysis
    const reportFile = `${RECOVERY_DIR}/recovery-analysis-report.json`;
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

    // Save detailed job analysis
    const detailsFile = `${RECOVERY_DIR}/job-analysis-details.json`;
    fs.writeFileSync(detailsFile, JSON.stringify(this.analysisResults, null, 2));

    console.log(`✅ Analysis report saved to ${reportFile}`);
    console.log(`✅ Job details saved to ${detailsFile}`);

    return report;
  }

  async createRecoveryScript() {
    if (this.recoveryJobs.length === 0) {
      console.log('ℹ️ No jobs need recovery - skipping script creation');
      return;
    }

    console.log(`🔧 Creating recovery script for ${this.recoveryJobs.length} jobs...`);

    const scriptContent = `#!/usr/bin/env node

/**
 * 🔄 BullMQ Recovery Script
 *
 * This script adds ${this.recoveryJobs.length} failed jobs back to BullMQ for reprocessing
 * Generated on ${new Date().toISOString()}
 */

import { Queue } from 'bullmq';
import Redis from 'ioredis';
import fs from 'fs';

const redis = new Redis({ host: 'localhost', port: 6379 });
const queue = new Queue('transcription', { connection: redis });

const recoveryJobs = ${JSON.stringify(this.recoveryJobs, null, 2)};

async function addRecoveryJobs() {
  console.log('🔄 Adding \${recoveryJobs.length} failed jobs to BullMQ for reprocessing...');

  let added = 0;
  let skipped = 0;
  let errors = 0;

  for (const job of recoveryJobs) {
    try {
      // Double-check that input file still exists
      if (!fs.existsSync(job.filePath)) {
        console.log(\`⏭️ Skipping \${job.fileName} - input file no longer exists\`);
        skipped++;
        continue;
      }

      // Add job to BullMQ with recovery metadata
      await queue.add('transcribe', {
        id: job.id + '-recovery', // Add suffix to avoid ID conflicts
        fileName: job.fileName,
        filePath: job.filePath,
        fileSize: job.fileSize,
        status: 'pending',
        priority: 2, // High priority for recovery jobs
        progress: 0,
        attempts: 0,
        maxAttempts: 3,
        metadata: {
          originalPath: job.filePath,
          recoveredFromSQLite: true,
          originalJobId: job.id,
          originalError: job.error,
          originalCreatedAt: job.createdAt,
          recoveryDate: new Date().toISOString()
        }
      }, {
        priority: 2, // High priority
        jobId: job.id + '-recovery'
      });

      console.log(\`✅ Added \${job.fileName} (original error: \${job.error})\`);
      added++;

    } catch (error) {
      console.error(\`❌ Failed to add \${job.fileName}:\`, error.message);
      errors++;
    }
  }

  console.log(\`\\n📊 Recovery Summary:\`);
  console.log(\`   Added to queue: \${added}\`);
  console.log(\`   Skipped: \${skipped}\`);
  console.log(\`   Errors: \${errors}\`);
  console.log(\`   Total: \${recoveryJobs.length}\`);

  await redis.disconnect();

  if (added > 0) {
    console.log(\`\\n🎉 Successfully added \${added} jobs for reprocessing!\`);
    console.log('Monitor the dashboard to see progress: http://100.77.230.53:8080/transcription-dashboard');
  }
}

addRecoveryJobs().catch(console.error);
`;

    const scriptFile = `${RECOVERY_DIR}/add-recovery-jobs-to-bullmq.js`;
    fs.writeFileSync(scriptFile, scriptContent);
    fs.chmodSync(scriptFile, 0o755); // Make executable

    console.log(`✅ Recovery script created: ${scriptFile}`);
    console.log('   Run this script to add failed jobs back to the queue');

    return scriptFile;
  }

  printSummary() {
    console.log(`\\n📋 Recovery Analysis Summary:`);
    console.log(`   Total failed jobs: ${this.stats.totalFailed}`);
    console.log(`   Input files exist: ${this.stats.inputFileExists}`);
    console.log(`   Input files missing: ${this.stats.inputFileMissing}`);
    console.log(`   Transcripts exist: ${this.stats.transcriptExists}`);
    console.log(`   Transcripts missing: ${this.stats.transcriptMissing}`);
    console.log(`   Need reprocessing: ${this.stats.needsReprocessing}`);
    console.log(`   Unrecoverable: ${this.stats.skipped}`);
    console.log(`   Analysis errors: ${this.stats.errors}`);

    console.log(`\\n📁 Files created:`);
    console.log(`   - ${RECOVERY_DIR}/recovery-analysis-report.json`);
    console.log(`   - ${RECOVERY_DIR}/job-analysis-details.json`);
    if (this.recoveryJobs.length > 0) {
      console.log(`   - ${RECOVERY_DIR}/add-recovery-jobs-to-bullmq.js`);
    }

    if (this.stats.needsReprocessing > 0) {
      console.log(`\\n🔄 Next Steps:`);
      console.log(`   1. Review the analysis report`);
      console.log(`   2. Run: node ${RECOVERY_DIR}/add-recovery-jobs-to-bullmq.js`);
      console.log(`   3. Monitor dashboard for progress`);
    } else {
      console.log(`\\n✅ No jobs need recovery - all failed jobs either have transcripts or missing input files`);
    }
  }
}

// Run recovery analysis
if (import.meta.main) {
  const recovery = new TranscriptionRecovery();
  recovery.analyze().catch(error => {
    console.error('Recovery analysis failed:', error);
    process.exit(1);
  });
}
