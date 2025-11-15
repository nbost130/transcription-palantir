/**
 * 🔮 Transcription Palantir - Redis Connection Test
 *
 * Tests Redis connection and validates queue functionality
 */

import { Redis } from 'ioredis';
import { logger } from '../src/utils/logger.js';
import { appConfig, getRedisUrl } from '../src/config/index.js';

async function testRedisConnection() {
  console.log('🔮 Testing Redis Connection...\n');

  const redis = new Redis(getRedisUrl(), {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  try {
    // Test 1: Connection
    console.log('📡 Test 1: Connecting to Redis...');
    await redis.connect();
    console.log('✅ Connected successfully\n');

    // Test 2: Basic operations
    console.log('📝 Test 2: Testing basic operations...');
    await redis.set('test:key', 'test-value');
    const value = await redis.get('test:key');
    console.log(`✅ SET/GET working: ${value}\n`);

    // Test 3: Redis info
    console.log('📊 Test 3: Redis server info...');
    const info = await redis.info('server');
    const version = info.match(/redis_version:(.+)/)?.[1];
    console.log(`✅ Redis version: ${version}\n`);

    // Test 4: Pub/Sub
    console.log('📡 Test 4: Testing Pub/Sub...');
    const subscriber = redis.duplicate();
    await subscriber.connect();

    await new Promise((resolve) => {
      subscriber.subscribe('test:channel', () => {
        redis.publish('test:channel', 'test-message');

        subscriber.on('message', (channel, message) => {
          console.log(`✅ Pub/Sub working: ${message}\n`);
          subscriber.quit();
          resolve(true);
        });
      });
    });

    // Test 5: List operations (for BullMQ)
    console.log('📋 Test 5: Testing list operations (BullMQ compatibility)...');
    await redis.lpush('test:queue', 'job1', 'job2', 'job3');
    const length = await redis.llen('test:queue');
    const job = await redis.rpop('test:queue');
    console.log(`✅ List operations working: length=${length}, popped=${job}\n`);

    // Cleanup
    await redis.del('test:key', 'test:queue');

    console.log('🎉 All Redis tests passed!\n');
    console.log('Configuration:');
    console.log(`  Host: ${appConfig.redis.host}`);
    console.log(`  Port: ${appConfig.redis.port}`);
    console.log(`  DB: ${appConfig.redis.db}`);

  } catch (error) {
    console.error('❌ Redis test failed:', error);
    process.exit(1);
  } finally {
    await redis.quit();
  }
}

// Run if executed directly
if (import.meta.main) {
  testRedisConnection().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { testRedisConnection };
