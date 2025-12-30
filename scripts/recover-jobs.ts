
import { Redis } from 'ioredis';

const redis = new Redis({
    host: 'localhost',
    port: 6379,
    db: 0,
});

async function recover() {
    console.log('Starting recovery...');

    // Scan for job keys
    const keys = await redis.keys('bull:transcription:*');
    console.log(`Found ${keys.length} keys total`);

    const jobKeys = keys.filter(k => {
        // Filter out meta keys
        return !k.includes(':meta') &&
            !k.includes(':id') &&
            !k.includes(':events') &&
            !k.includes(':stalled-check') &&
            !k.includes(':repeat') &&
            !k.includes(':delayed') &&
            !k.includes(':wait') &&
            !k.includes(':active') &&
            !k.includes(':completed') &&
            !k.includes(':failed') &&
            !k.includes(':prioritized');
    });

    console.log(`Found ${jobKeys.length} potential job keys`);

    let recovered = 0;

    for (const key of jobKeys) {
        const jobId = key.split(':').pop();
        if (!jobId) continue;

        // Check if job is already in any list
        const [isCompleted, isFailed, isWaiting, isActive] = await Promise.all([
            redis.zscore('bull:transcription:completed', jobId),
            redis.zscore('bull:transcription:failed', jobId),
            redis.lpos('bull:transcription:wait', jobId),
            redis.lpos('bull:transcription:active', jobId),
        ]);

        if (isCompleted !== null || isFailed !== null || isWaiting !== null || isActive !== null) {
            // console.log(`Job ${jobId} is already linked. Skipping.`);
            continue;
        }

        // Get job data to determine status
        const jobData = await redis.hgetall(key);
        if (!jobData || !jobData.name) {
            console.log(`Key ${key} is not a valid job. Skipping.`);
            continue;
        }

        const timestamp = parseInt(jobData.timestamp || Date.now().toString());
        const finishedOn = parseInt(jobData.finishedOn || Date.now().toString());

        if (jobData.returnvalue) {
            // Completed
            console.log(`Recovering COMPLETED job ${jobId}`);
            await redis.zadd('bull:transcription:completed', finishedOn, jobId);
            recovered++;
        } else if (jobData.failedReason) {
            // Failed
            console.log(`Recovering FAILED job ${jobId}`);
            await redis.zadd('bull:transcription:failed', finishedOn, jobId);
            recovered++;
        } else if (jobData.processedOn) {
            // It was processed but has no return value or failed reason?
            // Maybe it's active? Or stuck?
            // If processedOn exists but no finishedOn, it might be active or stalled.
            if (!jobData.finishedOn) {
                console.log(`Recovering ACTIVE (stalled?) job ${jobId}`);
                // Re-add to wait to be safe? Or active?
                // Let's add to failed with "Unknown state" to be safe, or wait.
                // Better to add to 'wait' so it gets retried?
                // Or 'failed' so user can retry?
                // Let's put in 'failed' with a special reason if missing.
                await redis.zadd('bull:transcription:failed', timestamp, jobId);
                await redis.hset(key, 'failedReason', 'Recovered from unknown state');
                recovered++;
            } else {
                // Has finishedOn but no returnvalue/failedReason?
                console.log(`Recovering COMPLETED (empty result) job ${jobId}`);
                await redis.zadd('bull:transcription:completed', finishedOn, jobId);
                recovered++;
            }
        } else {
            // Pending/Waiting
            console.log(`Recovering WAITING job ${jobId}`);
            await redis.lpush('bull:transcription:wait', jobId);
            recovered++;
        }
    }

    console.log(`Recovery complete. Recovered ${recovered} jobs.`);
    redis.disconnect();
}

recover().catch(console.error);
