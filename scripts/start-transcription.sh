#!/bin/bash

# Start TypeScript Transcription System on Mithrandir
echo "🚀 Starting TypeScript Transcription System"
echo "============================================"

# Kill any existing Python processes
ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "pkill -f whisper_batch.py; pkill -f concurrent_watcher"

# Start the new TypeScript system
echo "📊 Current queue status:"
ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "cd ~/transcription-ts && export PATH=~/.bun/bin:\$PATH && bun transcriber.ts status"

echo ""
echo "🎯 Starting continuous processing..."
ssh -i ~/.ssh/id_rsa_automation nbost@100.77.230.53 "cd ~/transcription-ts && export PATH=~/.bun/bin:\$PATH && nohup bun -e \"
const processor = require('./simple-processor.ts');

async function continuousProcess() {
  console.log('🔄 Starting continuous processing...');
  
  while (true) {
    try {
      const hasMore = await processor.processNext();
      if (!hasMore) {
        console.log('⏳ No jobs available, waiting 30 seconds...');
        await new Promise(resolve => setTimeout(resolve, 30000));
      } else {
        // Small delay between jobs
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error('❌ Error in continuous processing:', error);
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}

continuousProcess();
\" > /mnt/data/whisper-batch/logs/typescript-processor.log 2>&1 &"

echo "✅ TypeScript transcription system started!"
echo "📋 Monitor progress with:"
echo "   ssh nbost@100.77.230.53 'tail -f /mnt/data/whisper-batch/logs/typescript-processor.log'"
echo "   ssh nbost@100.77.230.53 'cd ~/transcription-ts && export PATH=~/.bun/bin:\$PATH && bun transcriber.ts status'"
