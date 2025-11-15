#!/usr/bin/env bun
/**
 * 🎤 Test Whisper Integration
 * 
 * Quick test to verify our Whisper setup works with the transcription system
 */

import { TranscriptionWorker } from './src/workers/transcription-worker.js';
import { logger } from './src/utils/logger.js';
import { mkdir } from 'fs/promises';
import { join } from 'path';

async function testWhisperIntegration() {
  logger.info('🎤 Testing Whisper Integration');

  try {
    // Ensure directories exist
    await mkdir('audio-samples', { recursive: true });
    await mkdir('transcripts/test', { recursive: true });

    // Create a test worker
    const worker = new TranscriptionWorker();

    // Test the transcription method directly
    const inputPath = join(process.cwd(), 'audio-samples/test-audio.wav');
    const outputPath = join(process.cwd(), 'transcripts/test/test-output');

    logger.info({ inputPath, outputPath }, 'Starting transcription test');

    const result = await worker['runTranscription'](
      inputPath,
      outputPath,
      async (progress: number) => {
        logger.info({ progress }, 'Transcription progress');
      }
    );

    logger.info({ result }, '✅ Transcription completed successfully!');
    
    // Read and display the result
    const { readFile } = await import('fs/promises');
    const transcriptContent = await readFile(result, 'utf-8');
    
    console.log('\n🎯 TRANSCRIPTION RESULT:');
    console.log('=' .repeat(50));
    console.log(transcriptContent.trim());
    console.log('=' .repeat(50));
    
    logger.info('🎉 Whisper integration test completed successfully!');
    
  } catch (error) {
    logger.error({ error }, '❌ Whisper integration test failed');
    throw error;
  }
}

// Run the test
if (import.meta.main) {
  testWhisperIntegration()
    .then(() => {
      console.log('\n✅ Test completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Test failed:', error.message);
      process.exit(1);
    });
}
