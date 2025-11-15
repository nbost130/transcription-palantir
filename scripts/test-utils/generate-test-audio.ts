/**
 * 🔮 Transcription Palantir - Test Audio Generator
 *
 * Generates synthetic audio files for testing the transcription pipeline
 */

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

interface AudioFileOptions {
  duration: number; // Duration in seconds
  sampleRate: number; // Sample rate in Hz
  channels: number; // Number of channels (1 = mono, 2 = stereo)
  frequency: number; // Tone frequency in Hz
}

/**
 * Generate a simple WAV file with a sine wave tone
 * This creates a valid WAV file that can be used for testing
 */
async function generateWavFile(
  outputPath: string,
  options: AudioFileOptions = {
    duration: 5,
    sampleRate: 44100,
    channels: 1,
    frequency: 440, // A4 note
  }
): Promise<void> {
  const { duration, sampleRate, channels, frequency } = options;

  const numSamples = Math.floor(duration * sampleRate);
  const bytesPerSample = 2; // 16-bit audio
  const dataSize = numSamples * channels * bytesPerSample;

  // WAV file header
  const header = Buffer.alloc(44);

  // RIFF chunk descriptor
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);

  // fmt sub-chunk
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
  header.writeUInt16LE(1, 20); // AudioFormat (1 for PCM)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bytesPerSample, 28); // ByteRate
  header.writeUInt16LE(channels * bytesPerSample, 32); // BlockAlign
  header.writeUInt16LE(bytesPerSample * 8, 34); // BitsPerSample

  // data sub-chunk
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  // Generate audio data (sine wave)
  const audioData = Buffer.alloc(dataSize);
  const amplitude = 32767 * 0.5; // 50% volume

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.floor(amplitude * Math.sin(2 * Math.PI * frequency * t));

    for (let ch = 0; ch < channels; ch++) {
      const offset = (i * channels + ch) * bytesPerSample;
      audioData.writeInt16LE(sample, offset);
    }
  }

  // Combine header and data
  const wavFile = Buffer.concat([header, audioData]);
  await writeFile(outputPath, wavFile);
}

/**
 * Generate multiple test audio files with different characteristics
 */
async function generateTestAudioFiles(outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });

  const testFiles = [
    {
      name: 'test-short-5s.wav',
      duration: 5,
      sampleRate: 44100,
      channels: 1,
      frequency: 440,
    },
    {
      name: 'test-medium-30s.wav',
      duration: 30,
      sampleRate: 44100,
      channels: 1,
      frequency: 523, // C5 note
    },
    {
      name: 'test-stereo-10s.wav',
      duration: 10,
      sampleRate: 48000,
      channels: 2,
      frequency: 659, // E5 note
    },
    {
      name: 'test-low-sample-rate.wav',
      duration: 10,
      sampleRate: 22050,
      channels: 1,
      frequency: 330,
    },
    {
      name: 'test-high-frequency.wav',
      duration: 5,
      sampleRate: 44100,
      channels: 1,
      frequency: 880, // A5 note
    },
  ];

  console.log('🎵 Generating test audio files...\n');

  for (const file of testFiles) {
    const filePath = join(outputDir, file.name);
    await generateWavFile(filePath, file);

    const fileSizeKB = Math.round((file.duration * file.sampleRate * file.channels * 2) / 1024);
    console.log(`✅ Generated: ${file.name}`);
    console.log(`   Duration: ${file.duration}s, Sample Rate: ${file.sampleRate}Hz, Channels: ${file.channels}`);
    console.log(`   Size: ~${fileSizeKB}KB\n`);
  }

  console.log(`🎉 Generated ${testFiles.length} test audio files in ${outputDir}`);
}

/**
 * Create metadata file for test audio
 */
async function createTestMetadata(outputDir: string): Promise<void> {
  const metadata = {
    generated: new Date().toISOString(),
    purpose: 'Testing transcription-palantir system',
    files: [
      {
        name: 'test-short-5s.wav',
        description: 'Short 5-second test file (URGENT priority)',
        expectedPriority: 'URGENT',
        size: 'Small (<10MB)',
      },
      {
        name: 'test-medium-30s.wav',
        description: '30-second test file (HIGH priority)',
        expectedPriority: 'HIGH',
        size: 'Small (<10MB)',
      },
      {
        name: 'test-stereo-10s.wav',
        description: 'Stereo test file',
        expectedPriority: 'URGENT',
        size: 'Small (<10MB)',
      },
      {
        name: 'test-low-sample-rate.wav',
        description: 'Low sample rate test',
        expectedPriority: 'URGENT',
        size: 'Small (<10MB)',
      },
      {
        name: 'test-high-frequency.wav',
        description: 'High frequency tone test',
        expectedPriority: 'URGENT',
        size: 'Small (<10MB)',
      },
    ],
    notes: [
      'These files contain pure sine waves at various frequencies',
      'Whisper.cpp will not produce meaningful transcriptions from these tones',
      'Use these files to test the pipeline, not transcription accuracy',
      'For real transcription testing, use actual speech audio files',
    ],
  };

  await writeFile(
    join(outputDir, 'test-audio-metadata.json'),
    JSON.stringify(metadata, null, 2)
  );
}

// Command-line interface
if (import.meta.main) {
  const outputDir = process.argv[2] || '/tmp/audio-input';

  generateTestAudioFiles(outputDir)
    .then(() => createTestMetadata(outputDir))
    .then(() => {
      console.log('\n📋 Test metadata created');
      console.log('\n💡 Usage:');
      console.log('  1. Start the file watcher');
      console.log('  2. These files will be automatically detected and queued');
      console.log('  3. Check the queue and job processing via API');
    })
    .catch((error) => {
      console.error('❌ Error generating test files:', error);
      process.exit(1);
    });
}

export { generateWavFile, generateTestAudioFiles, createTestMetadata };
