/**
 * 🔮 Transcription Palantir - Sample Data Generator
 *
 * Generates sample jobs and data for testing and development
 */

import { randomUUID } from 'crypto';
import { JobStatus, JobPriority, type TranscriptionJob } from '../src/types/index.js';

/**
 * Generate sample job data
 */
function generateSampleJob(overrides?: Partial<TranscriptionJob>): Partial<TranscriptionJob> {
  const fileNames = [
    'meeting-2024-01-15.mp3',
    'interview-candidate-smith.wav',
    'podcast-episode-42.m4a',
    'lecture-quantum-physics.mp3',
    'customer-call-12345.wav',
    'presentation-q4-results.mp4',
    'webinar-marketing-strategies.mp3',
    'conference-keynote.wav',
  ];

  const fileName = fileNames[Math.floor(Math.random() * fileNames.length)];
  const extension = fileName.split('.').pop() || 'mp3';

  // Random file size between 1MB and 100MB
  const fileSize = Math.floor(Math.random() * 99 * 1024 * 1024) + 1024 * 1024;

  // Determine priority based on file size
  let priority = JobPriority.NORMAL;
  const fileSizeMB = fileSize / (1024 * 1024);
  if (fileSizeMB < 10) {
    priority = JobPriority.URGENT;
  } else if (fileSizeMB < 50) {
    priority = JobPriority.HIGH;
  } else if (fileSizeMB > 100) {
    priority = JobPriority.LOW;
  }

  const mimeTypes: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    mp4: 'video/mp4',
  };

  return {
    id: randomUUID(),
    fileName,
    filePath: `/tmp/audio-input/${fileName}`,
    fileSize,
    mimeType: mimeTypes[extension] || 'audio/mpeg',
    status: JobStatus.PENDING,
    priority,
    progress: 0,
    createdAt: new Date(),
    attempts: 0,
    maxAttempts: 3,
    metadata: {
      originalPath: `/tmp/audio-input/${fileName}`,
      audioFormat: extension,
      whisperModel: 'small',
      language: 'auto',
    },
    ...overrides,
  };
}

/**
 * Generate multiple sample jobs
 */
function generateSampleJobs(count: number): Partial<TranscriptionJob>[] {
  const jobs: Partial<TranscriptionJob>[] = [];

  for (let i = 0; i < count; i++) {
    jobs.push(generateSampleJob());
  }

  return jobs;
}

/**
 * Generate jobs with specific statuses for testing
 */
function generateJobsByStatus(): {
  pending: Partial<TranscriptionJob>[];
  processing: Partial<TranscriptionJob>[];
  completed: Partial<TranscriptionJob>[];
  failed: Partial<TranscriptionJob>[];
} {
  return {
    pending: [
      generateSampleJob({ status: JobStatus.PENDING }),
      generateSampleJob({ status: JobStatus.PENDING }),
      generateSampleJob({ status: JobStatus.PENDING }),
    ],
    processing: [
      generateSampleJob({
        status: JobStatus.PROCESSING,
        progress: 35,
        startedAt: new Date(Date.now() - 60000), // Started 1 minute ago
      }),
      generateSampleJob({
        status: JobStatus.PROCESSING,
        progress: 72,
        startedAt: new Date(Date.now() - 120000), // Started 2 minutes ago
      }),
    ],
    completed: [
      generateSampleJob({
        status: JobStatus.COMPLETED,
        progress: 100,
        startedAt: new Date(Date.now() - 300000),
        completedAt: new Date(Date.now() - 60000),
        duration: 240000, // 4 minutes
        transcriptPath: '/tmp/transcripts/test-transcript.txt',
      }),
      generateSampleJob({
        status: JobStatus.COMPLETED,
        progress: 100,
        startedAt: new Date(Date.now() - 600000),
        completedAt: new Date(Date.now() - 300000),
        duration: 300000, // 5 minutes
        transcriptPath: '/tmp/transcripts/test-transcript-2.txt',
      }),
    ],
    failed: [
      generateSampleJob({
        status: JobStatus.FAILED,
        progress: 45,
        attempts: 3,
        error: 'File format not supported',
        startedAt: new Date(Date.now() - 180000),
      }),
    ],
  };
}

/**
 * Print sample jobs to console
 */
function printSampleJobs(count: number = 5): void {
  console.log('🔮 Sample Job Data\n');

  const jobs = generateSampleJobs(count);

  jobs.forEach((job, index) => {
    console.log(`Job ${index + 1}:`);
    console.log(`  ID: ${job.id}`);
    console.log(`  File: ${job.fileName}`);
    console.log(`  Size: ${((job.fileSize || 0) / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Priority: ${JobPriority[job.priority!]}`);
    console.log(`  Status: ${job.status}`);
    console.log('');
  });
}

/**
 * Export sample jobs to JSON file
 */
async function exportSampleJobs(outputPath: string, count: number = 10): Promise<void> {
  const { writeFile } = await import('fs/promises');

  const jobs = generateSampleJobs(count);
  const jobsByStatus = generateJobsByStatus();

  const data = {
    generated: new Date().toISOString(),
    totalJobs: count,
    jobs,
    jobsByStatus,
    summary: {
      pending: jobsByStatus.pending.length,
      processing: jobsByStatus.processing.length,
      completed: jobsByStatus.completed.length,
      failed: jobsByStatus.failed.length,
    },
  };

  await writeFile(outputPath, JSON.stringify(data, null, 2));
  console.log(`✅ Exported ${count} sample jobs to ${outputPath}`);
}

// CLI
if (import.meta.main) {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'print':
      const count = parseInt(args[1]) || 5;
      printSampleJobs(count);
      break;

    case 'export':
      const outputPath = args[1] || './tests/fixtures/sample-jobs.json';
      const exportCount = parseInt(args[2]) || 10;
      exportSampleJobs(outputPath, exportCount);
      break;

    default:
      console.log('🔮 Sample Data Generator\n');
      console.log('Usage:');
      console.log('  bun run scripts/generate-sample-data.ts print [count]');
      console.log('  bun run scripts/generate-sample-data.ts export [path] [count]');
      console.log('');
      console.log('Examples:');
      console.log('  bun run scripts/generate-sample-data.ts print 10');
      console.log('  bun run scripts/generate-sample-data.ts export ./sample-jobs.json 20');
  }
}

export { generateSampleJob, generateSampleJobs, generateJobsByStatus, exportSampleJobs };
