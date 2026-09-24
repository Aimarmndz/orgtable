import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rateLimit, resetRateLimit } from "@/app/lib/rate-limit";

// Limitador en memoria de ventana fija (ADR 0009). Un `>` en lugar de `>=` o un fallo al
// reiniciar la ventana cambiaría el límite real del login sin que nada lo detectara.
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
  it("permite `limit` intentos y bloquea el siguiente con el tiempo restante", () => {
    for (let i = 0; i < 10; i++) {
      expect(rateLimit("k", 10, 10 * MIN).ok).toBe(true);
    }
    expect(rateLimit("k", 10, 10 * MIN)).toEqual({
      ok: false,
      retryAfterSec: 600,
      firstBlock: true,
    });
  });

  it("retryAfterSec descuenta el tiempo ya pasado", () => {
    for (let i = 0; i < 10; i++) rateLimit("k", 10, 10 * MIN);
    vi.advanceTimersByTime(300 * 1000);
    expect(rateLimit("k", 10, 10 * MIN).retryAfterSec).toBe(300);
  });

  it("al llegar a resetAt abre una ventana nueva", () => {
    for (let i = 0; i < 11; i++) rateLimit("k", 10, 10 * MIN);
    vi.advanceTimersByTime(10 * MIN);
    expect(rateLimit("k", 10, 10 * MIN).ok).toBe(true);
  });

  it("claves distintas no se interfieren", () => {
    for (let i = 0; i < 11; i++) rateLimit("a", 10, 10 * MIN);
    expect(rateLimit("a", 10, 10 * MIN).ok).toBe(false);
    expect(rateLimit("b", 10, 10 * MIN).ok).toBe(true);
  });

  it("firstBlock solo en el primer rechazo de cada ventana", () => {
    const results = Array.from({ length: 5 }, () => rateLimit("k", 2, MIN));
    expect(results.map((r) => r.ok)).toEqual([true, true, false, false, false]);
    expect(results.map((r) => r.firstBlock)).toEqual([false, false, true, false, false]);

    vi.advanceTimersByTime(MIN);
    const next = Array.from({ length: 3 }, () => rateLimit("k", 2, MIN));
    expect(next.map((r) => r.firstBlock)).toEqual([false, false, true]);
  });

  it("resetRateLimit olvida los intentos de esa clave", () => {
    for (let i = 0; i < 3; i++) rateLimit("k", 2, MIN);
    resetRateLimit("k");
    expect(rateLimit("k", 2, MIN).ok).toBe(true);
  });
});
