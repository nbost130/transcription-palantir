/**
 * 🔮 Transcription Palantir - Faster-Whisper Service
 *
 * Python-based faster-whisper integration for high-performance transcription
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { appConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';

// =============================================================================
// TYPES
// =============================================================================

export interface FasterWhisperOptions {
  model?: string;
  language?: string;
  task?: 'transcribe' | 'translate';
  device?: 'cpu' | 'cuda';
  computeType?: 'float16' | 'int8' | 'float32';
  batchSize?: number;
  beamSize?: number;
  vadFilter?: boolean;
  wordTimestamps?: boolean;
}

export interface TranscriptionResult {
  text: string;
  segments?: TranscriptionSegment[];
  language?: string;
  duration?: number;
}

export interface TranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words?: TranscriptionWord[];
}

export interface TranscriptionWord {
  start: number;
  end: number;
  word: string;
  probability: number;
}

// =============================================================================
// FASTER-WHISPER SERVICE
// =============================================================================

export class FasterWhisperService {
  private pythonPath: string;
  private scriptPath: string;

  constructor() {
    this.pythonPath = appConfig.whisper.pythonPath || '/tmp/whisper-env/bin/python3';
    this.scriptPath = join(process.cwd(), 'scripts', 'faster_whisper_transcribe.py');
  }

  /**
   * Transcribe an audio file using faster-whisper
   */
  async transcribe(
    inputFile: string,
    outputDir: string,
    options: FasterWhisperOptions = {}
  ): Promise<TranscriptionResult> {
    // Ensure output directory exists
    await mkdir(outputDir, { recursive: true });

    // Prepare output file path
    const baseName = basename(inputFile, extname(inputFile));
    const outputFile = join(outputDir, `${baseName}.json`);

    // Build command arguments
    const args = this.buildPythonArgs(inputFile, outputFile, options);

    logger.info(
      {
        inputFile,
        outputFile,
        model: options.model || 'large-v3',
        device: options.device || 'cpu',
      },
      'Starting faster-whisper transcription'
    );

    try {
      // Run faster-whisper Python script (file growth monitor detects stuck processes)
      await this.runPythonScript(args, inputFile);

      // Read and parse the output
      const result = await this.parseTranscriptionOutput(outputFile);

      logger.info({ outputFile }, 'Faster-whisper transcription completed');

      return result;
    } catch (error) {
      logger.error({ error, inputFile }, 'Faster-whisper transcription failed');
      throw error;
    }
  }

  /**
   * Build Python script arguments
   */
  private buildPythonArgs(inputFile: string, outputFile: string, options: FasterWhisperOptions): string[] {
    const args = [
      this.scriptPath,
      '--input',
      inputFile,
      '--output',
      outputFile,
      '--model',
      options.model || 'large-v3',
      '--device',
      options.device || 'cpu',
      '--compute_type',
      options.computeType || 'float16',
    ];

    if (options.language && options.language !== 'auto') {
      args.push('--language', options.language);
    }

    if (options.task === 'translate') {
      args.push('--task', 'translate');
    }

    if (options.batchSize) {
      args.push('--batch_size', options.batchSize.toString());
    }

    if (options.beamSize) {
      args.push('--beam_size', options.beamSize.toString());
    }

    if (options.vadFilter) {
      args.push('--vad_filter');
    }

    if (options.wordTimestamps) {
      args.push('--word_timestamps');
    }

    return args;
  }

  /**
   * Run Python script without timeout - rely on file growth monitoring for stuck detection
   */
  private async runPythonScript(args: string[], inputPath?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.pythonPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      let _stdout = '';
      let isResolved = false;

      // Log start without timeout - file growth monitor will detect stuck processes
      logger.info({ inputPath }, 'Starting transcription process - file growth monitor will detect if stuck');

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
        // Log progress to help with debugging
        if (stderr.includes('Loading model:') || stderr.includes('Processing segments')) {
          logger.info({ progress: stderr.split('\n').pop() }, 'Transcription progress');
        }
      });

      child.stdout?.on('data', (data) => {
        _stdout += data.toString();
      });

      child.on('close', (code) => {
        if (!isResolved) {
          isResolved = true;

          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Python script failed with code ${code}. stderr: ${stderr}`));
          }
        }
      });

      child.on('error', (error) => {
        if (!isResolved) {
          isResolved = true;
          reject(new Error(`Failed to spawn Python: ${error.message}`));
        }
      });
    });
  }

  /**
   * Parse transcription output
   */
  private async parseTranscriptionOutput(outputFile: string): Promise<TranscriptionResult> {
    try {
      const content = await readFile(outputFile, 'utf-8');
      const json = JSON.parse(content);

      return {
        text: json.text || '',
        segments: json.segments || [],
        language: json.language,
        duration: json.duration,
      };
    } catch (error) {
      logger.error({ error, outputFile }, 'Failed to parse transcription output');
      throw new Error(`Failed to read transcription output: ${(error as Error).message}`);
    }
  }
}

export const fasterWhisperService = new FasterWhisperService();
