import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rateLimit, resetRateLimit } from "@/app/lib/rate-limit";

// In-memory fixed-window limiter (ADR 0009). A `>` instead of `>=` or a bug when resetting
// the window would change the real sign-in limit without anything noticing.
const MIN = 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T10:00:00Z"));
  (
    globalThis as { __orgtableRateBuckets?: Map<string, unknown> }
  ).__orgtableRateBuckets?.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("rateLimit", () => {
  it("allows `limit` attempts and blocks the next one with the remaining time", () => {
    for (let i = 0; i < 10; i++) {
      expect(rateLimit("k", 10, 10 * MIN).ok).toBe(true);
    }
    expect(rateLimit("k", 10, 10 * MIN)).toEqual({
      ok: false,
      retryAfterSec: 600,
      firstBlock: true,
    });
  });

  it("retryAfterSec subtracts the time already elapsed", () => {
    for (let i = 0; i < 10; i++) rateLimit("k", 10, 10 * MIN);
    vi.advanceTimersByTime(300 * 1000);
    expect(rateLimit("k", 10, 10 * MIN).retryAfterSec).toBe(300);
  });

  it("on reaching resetAt it opens a new window", () => {
    for (let i = 0; i < 11; i++) rateLimit("k", 10, 10 * MIN);
    vi.advanceTimersByTime(10 * MIN);
    expect(rateLimit("k", 10, 10 * MIN).ok).toBe(true);
  });

  it("different keys do not interfere", () => {
    for (let i = 0; i < 11; i++) rateLimit("a", 10, 10 * MIN);
    expect(rateLimit("a", 10, 10 * MIN).ok).toBe(false);
    expect(rateLimit("b", 10, 10 * MIN).ok).toBe(true);
  });

  it("firstBlock only on the first rejection of each window", () => {
    const results = Array.from({ length: 5 }, () => rateLimit("k", 2, MIN));
    expect(results.map((r) => r.ok)).toEqual([true, true, false, false, false]);
    expect(results.map((r) => r.firstBlock)).toEqual([false, false, true, false, false]);

    vi.advanceTimersByTime(MIN);
    const next = Array.from({ length: 3 }, () => rateLimit("k", 2, MIN));
    expect(next.map((r) => r.firstBlock)).toEqual([false, false, true]);
  });

  it("resetRateLimit forgets the attempts of that key", () => {
    for (let i = 0; i < 3; i++) rateLimit("k", 2, MIN);
    resetRateLimit("k");
    expect(rateLimit("k", 2, MIN).ok).toBe(true);
  });
});
