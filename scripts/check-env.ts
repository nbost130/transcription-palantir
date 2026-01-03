#!/usr/bin/env bun

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'dotenv';

const args = parseArgs({
  options: {
    'env-file': { type: 'string', short: 'e' },
    template: { type: 'string', short: 't' },
    platform: { type: 'string', short: 'p' },
  },
});

const targetPlatform = (args.values.platform ?? 'linux').toLowerCase();
if (targetPlatform !== 'linux' && targetPlatform !== 'darwin') {
  console.error(`Unsupported --platform value: ${targetPlatform}. Use 'linux' or 'darwin'.`);
  process.exit(1);
}

const envPath = resolve(args.values['env-file'] ?? '.env');
const templatePath = resolve(args.values.template ?? '.env.production');

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing environment file: ${filePath}`);
  }

  const contents = readFileSync(filePath, 'utf-8');
  return parse(contents);
}

function ensureValue(key: string, value: string | undefined, problems: string[]) {
  if (!value) {
    problems.push(`${key} is missing in target env file`);
  }
}

function detectOsMismatch(value: string): string | null {
  if (targetPlatform === 'linux' && value.startsWith('/Users/')) {
    return 'macOS-style path detected on Linux target';
  }

  if (targetPlatform === 'darwin' && value.startsWith('/mnt/')) {
    return 'Linux-style path detected on macOS target';
  }

  return null;
}

try {
  const templateEnv = loadEnvFile(templatePath);
  const targetEnv = loadEnvFile(envPath);

  const criticalKeys = ['WATCH_DIRECTORY', 'OUTPUT_DIRECTORY', 'COMPLETED_DIRECTORY', 'FAILED_DIRECTORY'];
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const key of criticalKeys) {
    const templateValue = templateEnv[key];
    const targetValue = targetEnv[key];

    ensureValue(key, targetValue, problems);

    if (!targetValue) {
      continue;
    }

    if (!targetValue.startsWith('/')) {
      problems.push(`${key} must be an absolute path. Received: ${targetValue}`);
    }

    const mismatchNote = detectOsMismatch(targetValue);
    if (mismatchNote) {
      problems.push(`${key}: ${mismatchNote} (${targetValue})`);
    }

    if (!templateValue) {
      warnings.push(`Template is missing ${key}. Add it to .env.production to enforce parity.`);
      continue;
    }

    if (templateValue !== targetValue) {
      problems.push(`${key} differs from template. Expected ${templateValue}, received ${targetValue}`);
    }
  }

  if (warnings.length > 0) {
    console.warn('⚠️  Warnings detected during environment validation:');
    for (const warning of warnings) {
      console.warn(`  - ${warning}`);
    }
  }

  if (problems.length > 0) {
    console.error('❌ Environment validation failed:');
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exit(1);
  }

  console.log('✅ Environment file matches .env.production for critical directories.');
  console.log(`Validated file: ${envPath}`);
  console.log(`Template: ${templatePath}`);
  console.log(`Target platform: ${targetPlatform}`);
} catch (error) {
  console.error(`❌ Failed to validate environment files: ${(error as Error).message}`);
  process.exit(1);
}
