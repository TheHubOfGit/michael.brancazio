import { CONFIG } from '../config';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const ipMap = new Map<string, RateLimitRecord>();

// Periodic cleanup of stale records
const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();

function cleanupStale() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  for (const [key, record] of ipMap.entries()) {
    if (record.resetAt <= now) {
      ipMap.delete(key);
    }
  }
}

export function checkRateLimit(request: Request): { allowed: boolean; remaining: number; reset: number } {
  cleanupStale();

  const clientIp = request.headers.get('CF-Connecting-IP') || 
                   request.headers.get('X-Forwarded-For') || 
                   'unknown-client';
  const now = Date.now();
  const windowMs = 60_000;
  const maxRequests = CONFIG.RATE_LIMIT.MAX_REQUESTS_PER_MINUTE;

  let record = ipMap.get(clientIp);
  if (!record || record.resetAt <= now) {
    record = {
      count: 1,
      resetAt: now + windowMs
    };
    ipMap.set(clientIp, record);
    return {
      allowed: true,
      remaining: maxRequests - 1,
      reset: Math.ceil((record.resetAt - now) / 1000)
    };
  }

  record.count += 1;
  const allowed = record.count <= maxRequests;
  const remaining = Math.max(0, maxRequests - record.count);
  const reset = Math.ceil((record.resetAt - now) / 1000);

  return { allowed, remaining, reset };
}
