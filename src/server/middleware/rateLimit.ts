import { CONFIG } from '../config';

interface RateLimitRecord {
  count: number;
  resetAt: number;
  tokens: number;
  updatedAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  reset: number;
}

// CF-Connecting-IP is set by Cloudflare; X-Forwarded-For is client-controlled.
export function getClientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || 'unknown-client';
}

/** Best-effort protection within one isolate, not a distributed quota. */
export function createRateLimiter(now: () => number = Date.now, maxClients: number = CONFIG.RATE_LIMIT.MAX_TRACKED_CLIENTS) {
  const records = new Map<string, RateLimitRecord>();
  const { MAX_REQUESTS_PER_MINUTE: maxRequests, BURST_CAPACITY: burst } = CONFIG.RATE_LIMIT;
  const refillPerMs = maxRequests / 60_000;
  let lastCleanup = 0;

  return (request: Request): RateLimitResult => {
    const time = now();
    if (time - lastCleanup >= 10_000) {
      for (const [key, record] of records) {
        if (record.updatedAt + 60_000 <= time) records.delete(key);
      }
      lastCleanup = time;
    }

    const key = getClientIp(request);
    let record = records.get(key);
    if (!record) {
      if (records.size >= maxClients) {
        return { allowed: false, remaining: 0, reset: 60 };
      }
      record = { count: 0, resetAt: time + 60_000, tokens: burst, updatedAt: time };
      records.set(key, record);
    } else if (record.resetAt <= time) {
      record.count = 0;
      record.resetAt = time + 60_000;
    }

    record.tokens = Math.min(burst, record.tokens + Math.max(0, time - record.updatedAt) * refillPerMs);
    record.updatedAt = time;
    const allowed = record.count < maxRequests && record.tokens >= 1;
    if (allowed) {
      record.count += 1;
      record.tokens -= 1;
    }
    const reset = record.count >= maxRequests
      ? Math.ceil((record.resetAt - time) / 1000)
      : Math.max(0, Math.ceil((1 - record.tokens) / refillPerMs / 1000));
    return { allowed, remaining: Math.max(0, Math.min(maxRequests - record.count, Math.floor(record.tokens))), reset };
  };
}

export const checkRateLimit = createRateLimiter();

export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000) + result.reset),
    ...(!result.allowed ? { 'Retry-After': String(Math.max(1, result.reset)) } : {}),
  };
}
