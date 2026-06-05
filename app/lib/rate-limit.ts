import "server-only";

// Limitador de tasa en memoria (ventana fija). Suficiente para el despliegue estándar
// de una sola instancia: protege el login de fuerza bruta sin dependencias externas ni
// Redis. Para multi-instancia el conteo sería por réplica (límite documentado en
// docs/operations.md). El Map se guarda en globalThis para sobrevivir al HMR.

type Bucket = { count: number; resetAt: number };

const g = globalThis as unknown as {
  __orgtableRateBuckets?: Map<string, Bucket>;
};
const buckets = g.__orgtableRateBuckets ?? new Map<string, Bucket>();
g.__orgtableRateBuckets = buckets;

export type RateLimitResult = { ok: boolean; retryAfterSec: number };

/**
 * Cuenta un intento para `key`. Permite hasta `limit` por ventana de `windowMs`.
 * Devuelve { ok: false, retryAfterSec } cuando se supera el límite.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();

  // Limpieza perezosa para que el Map no crezca sin fin en instancias longevas.
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { ok: true, retryAfterSec: 0 };
}
