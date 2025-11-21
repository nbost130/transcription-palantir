/**
 * 🔮 Transcription Palantir - Whisper.cpp Service
 *
 * TypeScript wrapper for Whisper.cpp CLI transcription engine
 */

import { spawn } from 'child_process';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { join, dirname, basename, extname } from 'path';
import { appConfig, getWhisperCommand } from '../config/index.js';
import { logger } from '../utils/logger.js';

// =============================================================================
// TYPES
// =============================================================================

export interface WhisperOptions {
  model?: string;
  language?: string;
  task?: 'transcribe' | 'translate';
  outputFormat?: 'txt' | 'json' | 'srt' | 'vtt';
  threads?: number;
  processors?: number;
  beamSize?: number;
  temperature?: number;
  vadEnabled?: boolean;
  vadThreshold?: number;
  vadMinSpeechDuration?: number;
  vadMinSilenceDuration?: number;
  flashAttention?: boolean;
  verbose?: boolean;
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
}

export interface WhisperProgress {
  progress: number; // 0-100
  stage: 'loading' | 'processing' | 'finalizing';
  message?: string;
}

// =============================================================================
// WHISPER SERVICE
// =============================================================================

export class WhisperService {
  private binaryPath: string;
  private modelsPath: string;
  private availableModels = ['tiny', 'base', 'small', 'medium', 'large'];

  constructor() {
    this.binaryPath = appConfig.whisper.binaryPath;
    this.modelsPath = join(dirname(this.binaryPath), 'models');
  }

  // ===========================================================================
  // BINARY & MODEL VALIDATION
  // ===========================================================================

  /**
   * Check if Whisper.cpp binary exists and is executable
   */
  async validateBinary(): Promise<boolean> {
    try {
      await access(this.binaryPath, constants.X_OK);
      logger.debug({ path: this.binaryPath }, 'Whisper.cpp binary found');
      return true;
    } catch (error) {
      logger.warn({ path: this.binaryPath }, 'Whisper.cpp binary not found or not executable');
      return false;
    }
  }

  /**
   * Check if a specific model exists
   */
  async validateModel(modelName: string): Promise<boolean> {
    // Handle both full path and model name
    const modelPath = modelName.includes('/')
      ? modelName  // Full path provided
      : join(this.modelsPath, `ggml-${modelName}.bin`);  // Just model name

    try {
      await access(modelPath, constants.R_OK);
      logger.debug({ model: modelName, path: modelPath }, 'Whisper model found');
      return true;
    } catch (error) {
      logger.warn({ model: modelName, path: modelPath }, 'Whisper model not found');
      return false;
    }
  }

  /**
   * Get list of installed models
   */
  async getInstalledModels(): Promise<string[]> {
    const installed: string[] = [];

    for (const model of this.availableModels) {
      if (await this.validateModel(model)) {
        installed.push(model);
      }
    }

    return installed;
  }

  // ===========================================================================
  // TRANSCRIPTION
  // ===========================================================================

  /**
   * Transcribe an audio file using Whisper.cpp
   */
  async transcribe(
    inputFile: string,
    outputDir: string,
    options: WhisperOptions = {},
    onProgress?: (progress: WhisperProgress) => void
  ): Promise<TranscriptionResult> {
    // Validate binary exists
    const binaryExists = await this.validateBinary();
    if (!binaryExists) {
      throw new Error(
        `Whisper.cpp binary not found at ${this.binaryPath}. ` +
        'Please install Whisper.cpp and update WHISPER_BINARY_PATH in your .env file.'
      );
    }

    // Validate model exists
    const model = options.model || appConfig.whisper.model;
    const modelExists = await this.validateModel(model);
    if (!modelExists) {
      throw new Error(
        `Whisper model '${model}' not found. ` +
        `Please download the model or use one of: ${(await this.getInstalledModels()).join(', ')}`
      );
    }

    // Ensure output directory exists
    await mkdir(outputDir, { recursive: true });

    // Prepare output file path
    const baseName = basename(inputFile, extname(inputFile));
    const outputFormat = options.outputFormat || 'txt';
    const outputFile = join(outputDir, `${baseName}.${outputFormat}`);

    // Build command
    const args = this.buildWhisperArgs(inputFile, outputDir, baseName, options);

    logger.info({
      inputFile,
      outputFile,
      model,
      language: options.language,
      task: options.task,
    }, 'Starting Whisper.cpp transcription');

    try {
      // Run Whisper.cpp
      await this.runWhisper(args, onProgress);

      // Read the output file
      const result = await this.parseTranscriptionOutput(outputFile, outputFormat);

      logger.info({ outputFile }, 'Transcription completed successfully');

      return result;
    } catch (error) {
      logger.error({ error, inputFile }, 'Whisper.cpp transcription failed');
      throw error;
    }
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Build Whisper.cpp command arguments
   */
  private buildWhisperArgs(
    inputFile: string,
    outputDir: string,
    baseName: string,
    options: WhisperOptions
  ): string[] {
    const model = options.model || appConfig.whisper.model;
    const language = options.language || appConfig.whisper.language;
    const task = options.task || appConfig.whisper.task;
    const outputFormat = options.outputFormat || 'txt';

    // Handle both full path and model name
    const modelPath = model.includes('/')
      ? model  // Full path provided
      : join(this.modelsPath, `ggml-${model}.bin`);  // Just model name

    const args = [
      '-m', modelPath,
      '-f', inputFile,
    ];

    // Language (auto-detection if 'auto')
    if (language && language !== 'auto') {
      args.push('-l', language);
    }

    // Task (transcribe or translate)
    if (task === 'translate') {
      args.push('--translate');
    }

    // Output format (use proper flags like --output-txt)
    if (outputFormat === 'txt') {
      args.push('--output-txt');
    } else if (outputFormat === 'json') {
      args.push('--output-json');
    } else if (outputFormat === 'srt') {
      args.push('--output-srt');
    } else if (outputFormat === 'vtt') {
      args.push('--output-vtt');
    }

    // Output file path (without extension)
    args.push('--output-file', join(outputDir, baseName));

    // Threading - use all available cores by default
    const threads = options.threads || 8; // Default to 8 cores for your hardware
    args.push('-t', threads.toString());

    // Processors
    if (options.processors) {
      args.push('-p', options.processors.toString());
    }

    // Beam size for speed/accuracy trade-off
    if (options.beamSize !== undefined) {
      args.push('-bs', options.beamSize.toString());
    }

    // Temperature for sampling
    if (options.temperature !== undefined) {
      args.push('-tp', options.temperature.toString());
    }

    // Voice Activity Detection
    if (options.vadEnabled) {
      args.push('--vad');

      if (options.vadThreshold !== undefined) {
        args.push('-vt', options.vadThreshold.toString());
      }

      if (options.vadMinSpeechDuration !== undefined) {
        args.push('-vspd', options.vadMinSpeechDuration.toString());
      }

      if (options.vadMinSilenceDuration !== undefined) {
        args.push('-vsd', options.vadMinSilenceDuration.toString());
      }
    }

    // Flash attention (enabled by default, can disable)
    if (options.flashAttention === false) {
      args.push('-nfa');
    }

    // Verbose output
    if (options.verbose) {
      args.push('-v');
    }

    return args;
  }

  /**
   * Run Whisper.cpp binary and capture output
   */
  private async runWhisper(
    args: string[],
    onProgress?: (progress: WhisperProgress) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.binaryPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      let currentProgress = 0;

      // Capture stderr for progress tracking
      child.stderr?.on('data', (data) => {
        const output = data.toString();
        stderr += output;

        // Parse progress from Whisper output
        // Whisper typically outputs progress like: "progress =  42%"
        const progressMatch = output.match(/progress\s*=\s*(\d+)%/i);
        if (progressMatch && onProgress) {
          currentProgress = parseInt(progressMatch[1], 10);
          onProgress({
            progress: currentProgress,
            stage: 'processing',
            message: `Processing: ${currentProgress}%`,
          });
        }
      });

      // Capture stdout (not typically used by Whisper)
      child.stdout?.on('data', (data) => {
        logger.debug({ output: data.toString() }, 'Whisper stdout');
      });

      // Handle completion
      child.on('close', (code) => {
        if (code === 0) {
          if (onProgress) {
            onProgress({
              progress: 100,
              stage: 'finalizing',
              message: 'Transcription complete',
            });
          }
          resolve();
        } else {
          const error = new Error(
            `Whisper.cpp exited with code ${code}. stderr: ${stderr}`
          );
          reject(error);
        }
      });

      // Handle errors
      child.on('error', (error) => {
        reject(new Error(`Failed to spawn Whisper.cpp: ${error.message}`));
      });
    });
  }

  /**
   * Parse transcription output file
   */
  private async parseTranscriptionOutput(
    outputFile: string,
    format: string
  ): Promise<TranscriptionResult> {
    try {
      const content = await readFile(outputFile, 'utf-8');

      if (format === 'json') {
        // Parse JSON output
        const json = JSON.parse(content);
        return {
          text: json.text || '',
          segments: json.segments || [],
          language: json.language,
          duration: json.duration,
        };
      } else {
        // Plain text output
        return {
          text: content.trim(),
        };
      }
    } catch (error) {
      logger.error({ error, outputFile }, 'Failed to parse transcription output');
      throw new Error(`Failed to read transcription output: ${(error as Error).message}`);
    }
  }

  // ===========================================================================
  // MODEL MANAGEMENT
  // ===========================================================================

  /**
   * Get information about Whisper.cpp installation
   */
  async getSystemInfo(): Promise<{
    binaryPath: string;
    binaryExists: boolean;
    modelsPath: string;
    installedModels: string[];
    availableModels: string[];
  }> {
    const binaryExists = await this.validateBinary();
    const installedModels = await this.getInstalledModels();

    return {
      binaryPath: this.binaryPath,
      binaryExists,
      modelsPath: this.modelsPath,
      installedModels,
      availableModels: this.availableModels,
    };
  }

  /**
   * Get download instructions for missing models
   */
  getModelDownloadInstructions(modelName: string): string {
    const modelFile = `ggml-${modelName}.bin`;
    const downloadUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelFile}`;

    return `
To download the '${modelName}' model:

1. Create models directory:
   mkdir -p ${this.modelsPath}

2. Download the model:
   curl -L -o ${join(this.modelsPath, modelFile)} ${downloadUrl}

3. Verify the download:
   ls -lh ${join(this.modelsPath, modelFile)}

Alternatively, use the Whisper.cpp download script:
   bash ${join(dirname(this.binaryPath), 'models', 'download-ggml-model.sh')} ${modelName}
`;
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

export const whisperService = new WhisperService();
