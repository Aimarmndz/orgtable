import { isIP } from "node:net";

// Obtención de la IP del cliente para el rate limit del login y la auditoría. Lógica
// pura (sin next/headers) para poder probarla con tests unitarios; la usa clientIp() en
// app/lib/audit.ts. Ver docs/decisions/0009-in-memory-rate-limit.md.
//
// X-Forwarded-For la controla el cliente: cada proxy AÑADE la IP que ve al final de la
// lista, pero lo que venía antes lo escribió quien hizo la petición. Además, Next solo
// rellena la cabecera si no viene (`??=`), así que con la app expuesta sin proxy el
// cliente decide la cabecera entera. Por eso solo se confía en ella si se declaran los
// proxies de confianza que hay delante (TRUSTED_PROXY_HOPS) y se toma el valor que puso
// el más externo de ellos, contando desde la derecha.

/**
 * Número de proxies de confianza delante de la app. Vacío o sin definir = 0 (no se usa
 * X-Forwarded-For). Un valor que no sea un entero >= 0 es un error de configuración.
 */
export function parseTrustedProxyHops(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 0;
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `TRUSTED_PROXY_HOPS debe ser un entero >= 0 (recibido: "${value.slice(0, 20)}").`,
    );
  }
  return Number(value);
}

/**
 * IP del cliente según X-Forwarded-For y el número de proxies de confianza (`hops`).
 * Con hops = N devuelve el N-ésimo valor contando desde la derecha: el que añadió el
 * proxy de confianza más externo. Devuelve null si hops es 0, si la cabecera no llega o
 * tiene menos valores que N (la petición no pasó por todos los proxies) o si el valor no
 * es una IP.
 */
export function pickClientIp(xff: string | null, hops: number): string | null {
  if (hops <= 0 || !xff) return null;
  const parts = xff.split(",").map((part) => part.trim());
  if (parts.length < hops) return null;
  const candidate = parts[parts.length - hops];
  return candidate && isIP(candidate) ? candidate : null;
}
