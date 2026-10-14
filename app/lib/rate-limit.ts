import "server-only";

// In-memory rate limiter (fixed window). Enough for the standard single-instance
// deployment: it protects sign-in from brute force with no external dependencies or Redis.
// With several instances the count would be per replica (limitation documented in
// docs/operations.md). The Map lives in globalThis to survive HMR.

// `blocked` marks that the window has already rejected an attempt: it lets callers report
// only the FIRST block (firstBlock) instead of writing an audit row for every attempt
// rejected during a sustained attack.
type Bucket = { count: number; resetAt: number; blocked?: boolean };

const g = globalThis as unknown as {
  __orgtableRateBuckets?: Map<string, Bucket>;
};
const buckets = g.__orgtableRateBuckets ?? new Map<string, Bucket>();
g.__orgtableRateBuckets = buckets;

export type RateLimitResult = {
  ok: boolean;
  retryAfterSec: number;
  /** true only on the first rejected attempt of each window. */
  firstBlock: boolean;
};

/**
 * Counts an attempt for `key`. Allows up to `limit` per `windowMs` window.
 * Returns { ok: false, retryAfterSec } when the limit is exceeded.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();

  // Lazy cleanup so the Map does not grow forever on long-lived instances.
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0, firstBlock: false };
  }
  if (bucket.count >= limit) {
    const firstBlock = !bucket.blocked;
    bucket.blocked = true;
    return {
      ok: false,
      retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000),
      firstBlock,
    };
  }
  bucket.count += 1;
  return { ok: true, retryAfterSec: 0, firstBlock: false };
}

/** Forgets the attempts for `key` (e.g. after a successful sign-in). */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}
