# Incident Report: Service Crashes Due to DNS Cache Flushes

**Date:** 2025-12-26  
**Severity:** High  
**Status:** ✅ RESOLVED  
**GitHub Issue:** N/A (resolved before issue creation)

## Summary

The transcription service crashed multiple times on 2025-12-26 between 09:45-09:50 AM and stopped completely at 11:12 AM. The root cause was DNS resolution failures triggered by systemd-resolved cache flushes, which occurred when Docker containers started/stopped and Tailscale reconfigured DNS settings.

## Timeline

- **09:45:26 AM** - First DNS cache flush detected
- **09:45-09:50 AM** - Multiple service crashes with `DNSException: getaddrinfo ENOTFOUND` errors
- **11:12:35 AM** - Service stopped (manually stopped by user)
- **13:38:50 PM** - Service restarted with Redis connection resilience fix

## Root Cause

### Technical Details

The service was using `localhost` as the Redis hostname. When systemd-resolved flushed its DNS cache (triggered by Docker container network changes and Tailscale DNS reconfigurations), the ioredis client could not resolve "localhost" and threw unhandled `DNSException` errors, causing the service to crash.

### Trigger Chain

1. Docker containers start/stop → NetworkManager detects veth interface changes
2. Tailscale reconfigures DNS settings in response to network changes
3. systemd-resolved flushes DNS cache: `systemd-resolved[399]: Flushed all caches.`
4. ioredis attempts to connect to Redis using hostname "localhost"
5. DNS lookup fails during cache flush window
6. Unhandled error event crashes the Node.js process

### Evidence

From system logs:
```
Dec 26 09:45:26 mithrandir systemd-resolved[399]: Flushed all caches.
```

From service error logs:
```javascript
{
  name: "DNSException",
  message: "getaddrinfo ENOTFOUND",
  syscall: "getaddrinfo",
  errno: 4,
  code: "ENOTFOUND"
}

[ioredis] Unhandled error event: undefined
```

## Impact

- **Service Availability:** Multiple crashes between 09:45-09:50 AM, complete outage from 11:12 AM until manual restart
- **Data Loss:** None - jobs were preserved in Redis queue
- **User Impact:** Transcription processing stopped, pending files accumulated in inbox
- **Duration:** ~2 hours of intermittent failures, ~2.5 hours of complete outage

## Resolution

### Immediate Fix

Implemented Redis connection resilience with the following changes:

1. **Retry Strategy** - Exponential backoff with max 3 retries
2. **Reconnect on Error** - Automatic reconnection for transient errors (ECONNREFUSED, ENOTFOUND, ETIMEDOUT, etc.)
3. **Error Event Handling** - Proper error event listener to prevent crashes
4. **Connection Lifecycle Logging** - Comprehensive logging of connection events

### Code Changes

**Files Modified:**
- `src/types/index.ts` - Added Redis resilience config types
- `src/config/index.ts` - Added environment variables for resilience settings
- `src/services/queue.ts` - Implemented retry strategy and error handling
- `.env`, `.env.production`, `.env.example` - Added resilience configuration

**Key Implementation:**
```typescript
const redisConnection = new Redis(getRedisUrl(), {
  maxRetriesPerRequest: null,
  lazyConnect: false,
  connectTimeout: appConfig.redis.connectTimeout,
  enableOfflineQueue: appConfig.redis.enableOfflineQueue,
  
  retryStrategy(times: number): number | null {
    if (times > appConfig.redis.maxRetries) {
      queueLogger.error({ attempts: times }, 'Max Redis connection retries exceeded');
      return null;
    }
    const delay = Math.min(times * 50, 2000);
    queueLogger.warn({ attempt: times, delayMs: delay }, 'Redis connection failed, retrying...');
    return delay;
  },
  
  reconnectOnError(err: Error): boolean {
    const transientErrors = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'READONLY'];
    return transientErrors.some(errCode => err.message.includes(errCode));
  },
});

redisConnection.on('error', (err: Error) => {
  queueLogger.error({ error: err.message }, 'Redis connection error (will retry automatically)');
});
```

### Deployment

1. Developed and tested fix in local environment
2. Committed changes with descriptive commit message
3. Deployed to production using `scripts/deploy-to-mithrandir.sh`
4. Restarted service via systemd: `systemctl --user restart transcription-palantir`
5. Verified service started successfully with new resilience features

## Prevention

### Short-term
- ✅ Redis connection resilience implemented
- ✅ Comprehensive error handling for transient network issues
- ✅ Connection lifecycle logging for better observability

### Long-term
- Consider using `127.0.0.1` instead of `localhost` to avoid DNS lookups entirely (optional optimization)
- Monitor for DNS cache flush events and correlate with service behavior
- Add alerting for repeated connection failures

## Lessons Learned

1. **Always handle error events** - Unhandled error events in Node.js crash the process
2. **Network is unreliable** - Even localhost connections can fail during DNS cache flushes
3. **Resilience is critical** - Production services must handle transient failures gracefully
4. **Logging is essential** - Connection lifecycle logging helped diagnose the issue quickly

## Related Documentation

- `CLAUDE.md` - Updated with Redis resilience configuration section
- `src/services/queue.ts` - Implementation of connection resilience
- GitHub Actions deployment logs - Deployment verification

