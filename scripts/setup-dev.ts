#!/usr/bin/env bun

/**
 * 🔮 Transcription Palantir - Development Setup Script
 * 
 * Sets up the development environment with all necessary dependencies
 */

import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const PROJECT_ROOT = process.cwd();

// =============================================================================
// SETUP FUNCTIONS
// =============================================================================

function createDirectories(): void {
  const directories = [
    'audio-samples',
    'transcripts',
    'transcripts/completed',
    'transcripts/failed',
    'logs',
    'config/development',
    'config/staging',
    'config/production',
  ];

  console.log('📁 Creating project directories...');
  
  directories.forEach(dir => {
    const fullPath = join(PROJECT_ROOT, dir);
    if (!existsSync(fullPath)) {
      mkdirSync(fullPath, { recursive: true });
      console.log(`  ✅ Created: ${dir}`);
    } else {
      console.log(`  ⏭️  Exists: ${dir}`);
    }
  });
}

function setupEnvironmentFiles(): void {
  console.log('🔧 Setting up environment files...');
  
  const envFile = join(PROJECT_ROOT, '.env');
  const envExample = join(PROJECT_ROOT, '.env.example');
  
  if (!existsSync(envFile) && existsSync(envExample)) {
    copyFileSync(envExample, envFile);
    console.log('  ✅ Created .env from .env.example');
    console.log('  📝 Please review and update .env with your settings');
  } else if (existsSync(envFile)) {
    console.log('  ⏭️  .env already exists');
  } else {
    console.log('  ❌ .env.example not found');
  }
}

function checkDependencies(): void {
  console.log('🔍 Checking system dependencies...');
  
  const dependencies = [
    { name: 'bun', command: 'bun --version', required: true },
    { name: 'redis-server', command: 'redis-server --version', required: true },
    { name: 'docker', command: 'docker --version', required: false },
    { name: 'docker-compose', command: 'docker-compose --version', required: false },
  ];

  dependencies.forEach(dep => {
    try {
      const version = execSync(dep.command, { encoding: 'utf8', stdio: 'pipe' });
      console.log(`  ✅ ${dep.name}: ${version.trim().split('\n')[0]}`);
    } catch (error) {
      if (dep.required) {
        console.log(`  ❌ ${dep.name}: Not found (REQUIRED)`);
      } else {
        console.log(`  ⚠️  ${dep.name}: Not found (optional)`);
      }
    }
  });
}

function installProjectDependencies(): void {
  console.log('📦 Installing project dependencies...');
  
  try {
    execSync('bun install', { stdio: 'inherit', cwd: PROJECT_ROOT });
    console.log('  ✅ Dependencies installed successfully');
  } catch (error) {
    console.log('  ❌ Failed to install dependencies');
    console.error(error);
  }
}

function buildProject(): void {
  console.log('🔨 Building project...');
  
  try {
    execSync('bun run build', { stdio: 'inherit', cwd: PROJECT_ROOT });
    console.log('  ✅ Project built successfully');
  } catch (error) {
    console.log('  ❌ Failed to build project');
    console.error(error);
  }
}

function runTests(): void {
  console.log('🧪 Running tests...');
  
  try {
    execSync('bun test', { stdio: 'inherit', cwd: PROJECT_ROOT });
    console.log('  ✅ All tests passed');
  } catch (error) {
    console.log('  ⚠️  Some tests failed or no tests found');
  }
}

function printNextSteps(): void {
  console.log('\n🎉 Development setup complete!');
  console.log('\n📋 Next steps:');
  console.log('  1. Review and update .env file with your settings');
  console.log('  2. Start Redis server: redis-server');
  console.log('  3. Start development server: bun run dev');
  console.log('  4. Open http://localhost:3000 in your browser');
  console.log('\n🔧 Available commands:');
  console.log('  bun run dev          - Start development server');
  console.log('  bun run build        - Build for production');
  console.log('  bun run test         - Run tests');
  console.log('  bun run lint         - Run ESLint');
  console.log('  bun run format       - Format code with Prettier');
  console.log('  bun run docker:run   - Start with Docker Compose');
  console.log('\n📚 Documentation:');
  console.log('  README.md            - Project overview and setup');
  console.log('  docs/                - Detailed documentation');
}

// =============================================================================
// MAIN EXECUTION
// =============================================================================

async function main(): Promise<void> {
  console.log('🔮 Transcription Palantir - Development Setup\n');
  
  try {
    createDirectories();
    setupEnvironmentFiles();
    checkDependencies();
    installProjectDependencies();
    buildProject();
    runTests();
    printNextSteps();
  } catch (error) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  }
}

// Run setup if this script is executed directly
if (import.meta.main) {
  main().catch(console.error);
}
