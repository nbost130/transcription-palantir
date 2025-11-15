/**
 * 🔮 Transcription Palantir - Health Monitor Script
 *
 * Monitors the health of all services and reports status
 */

import { appConfig } from '../src/config/index.js';

interface HealthStatus {
  timestamp: string;
  healthy: boolean;
  services: {
    api: boolean;
    redis: boolean;
    queue: boolean;
  };
  details: any;
}

async function checkAPIHealth(): Promise<{ healthy: boolean; data?: any; error?: string }> {
  try {
    const response = await fetch(`http://localhost:${appConfig.port}/api/v1/health/detailed`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return { healthy: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    return { healthy: data.status === 'healthy', data };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function checkRedisHealth(): Promise<{ healthy: boolean; error?: string }> {
  const { Redis } = await import('ioredis');
  const { getRedisUrl } = await import('../src/config/index.js');

  const redis = new Redis(getRedisUrl(), {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    connectTimeout: 3000,
  });

  try {
    await redis.connect();
    await redis.ping();
    await redis.quit();
    return { healthy: true };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

async function getQueueStats(): Promise<any> {
  try {
    const response = await fetch(`http://localhost:${appConfig.port}/api/v1/queue/stats`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.data;
  } catch (error) {
    return null;
  }
}

async function monitorHealth(interval: number = 5000, continuous: boolean = false): Promise<void> {
  const check = async () => {
    console.clear();
    console.log('🔮 Transcription Palantir - Health Monitor');
    console.log('==========================================\n');

    const timestamp = new Date().toISOString();
    console.log(`⏰ Timestamp: ${timestamp}\n`);

    // Check API Health
    console.log('📡 API Server:');
    const apiHealth = await checkAPIHealth();
    if (apiHealth.healthy) {
      console.log('   ✅ Healthy');
      console.log(`   Uptime: ${apiHealth.data?.uptime.toFixed(2)}s`);
      console.log(`   Services: ${apiHealth.data?.services?.length || 0} registered`);
    } else {
      console.log(`   ❌ Unhealthy: ${apiHealth.error}`);
    }
    console.log('');

    // Check Redis Health
    console.log('🔴 Redis:');
    const redisHealth = await checkRedisHealth();
    if (redisHealth.healthy) {
      console.log('   ✅ Connected');
    } else {
      console.log(`   ❌ Disconnected: ${redisHealth.error}`);
    }
    console.log('');

    // Check Queue Stats
    console.log('📊 Queue Statistics:');
    const queueStats = await getQueueStats();
    if (queueStats) {
      console.log(`   Waiting: ${queueStats.waiting}`);
      console.log(`   Active: ${queueStats.active}`);
      console.log(`   Completed: ${queueStats.completed}`);
      console.log(`   Failed: ${queueStats.failed}`);
      console.log(`   Total: ${queueStats.total}`);
    } else {
      console.log('   ❌ Unable to fetch queue stats');
    }
    console.log('');

    // Overall Status
    const overallHealthy = apiHealth.healthy && redisHealth.healthy;
    console.log('═'.repeat(50));
    if (overallHealthy) {
      console.log('✅ Overall Status: HEALTHY');
    } else {
      console.log('❌ Overall Status: UNHEALTHY');
    }
    console.log('═'.repeat(50));

    if (continuous) {
      console.log(`\n⏳ Next check in ${interval / 1000}s... (Press Ctrl+C to stop)`);
    }
  };

  // Initial check
  await check();

  if (continuous) {
    // Continue checking at interval
    setInterval(check, interval);
  }
}

// CLI
if (import.meta.main) {
  const args = process.argv.slice(2);
  const continuous = args.includes('--watch') || args.includes('-w');
  const interval = parseInt(args.find(arg => arg.startsWith('--interval='))?.split('=')[1] || '5000');

  console.log('🔮 Starting Health Monitor...\n');

  if (continuous) {
    console.log(`📊 Monitoring mode: Continuous (every ${interval / 1000}s)`);
    console.log('Press Ctrl+C to stop\n');
  } else {
    console.log('📊 Monitoring mode: Single check\n');
  }

  monitorHealth(interval, continuous).catch((error) => {
    console.error('❌ Monitor error:', error);
    process.exit(1);
  });
}

export { monitorHealth, checkAPIHealth, checkRedisHealth, getQueueStats };
