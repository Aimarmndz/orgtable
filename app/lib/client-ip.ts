import { isIP } from "node:net";

// Obtención de la IP del cliente para el rate limit del login y la auditoría. Sin
// next/headers para poder probarla con tests unitarios; la usa clientIp() en
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

/** Por qué no se obtuvo IP aunque hay proxies de confianza declarados. */
export type ClientIpProblem = "missing-header" | "too-few-values" | "not-an-ip";

export type ClientIpResult =
  | { ip: string; problem: null }
  | { ip: null; problem: ClientIpProblem | null };

/**
 * IP del cliente según X-Forwarded-For y el número de proxies de confianza (`hops`).
 * Con hops = N toma el N-ésimo valor contando desde la derecha: el que añadió el proxy
 * de confianza más externo. Sin IP si hops es 0 (sin problema: es la configuración por
 * defecto), si la cabecera no llega, si tiene menos valores que N (la petición no pasó
 * por todos los proxies) o si el valor no es una IP. Función pura.
 */
export function resolveClientIp(xff: string | null, hops: number): ClientIpResult {
  if (hops <= 0) return { ip: null, problem: null };
  if (!xff) return { ip: null, problem: "missing-header" };
  const parts = xff.split(",").map((part) => part.trim());
  if (parts.length < hops) return { ip: null, problem: "too-few-values" };
  const ip = normalizeIp(parts[parts.length - hops]);
  return ip ? { ip, problem: null } : { ip: null, problem: "not-an-ip" };
}

/**
 * Algunos proxies (Azure Application Gateway, IIS ARR) escriben la IP con el puerto de
 * origen: `1.2.3.4:5678` o `[2001:db8::1]:443`. Sin quitarlo, isIP lo rechaza y el login
 * se queda sin límite por IP; y usarlo tal cual daría una clave distinta por conexión.
 * No se corta a ciegas por el último `:`, porque partiría una IPv6 sin corchetes.
 */
function normalizeIp(value: string): string | null {
  if (isIP(value)) return value;
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value);
  if (bracketed) return isIP(bracketed[1]) === 6 ? bracketed[1] : null;
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(value);
  if (v4WithPort) return isIP(v4WithPort[1]) === 4 ? v4WithPort[1] : null;
  return null;
}

const PROBLEM_DETAIL: Record<ClientIpProblem, string> = {
  "missing-header": "la petición no trae X-Forwarded-For",
  "too-few-values": "X-Forwarded-For trae menos valores que proxies declarados",
  "not-an-ip": "el valor de X-Forwarded-For que corresponde no es una IP",
};

// Un aviso por motivo y proceso: basta para que el operador lo vea en el log sin
// repetirlo en cada login.
const warnedProblems = new Set<ClientIpProblem>();

/**
 * Como resolveClientIp, pero avisa en el log (una vez por motivo y proceso) cuando hay
 * proxies declarados y no se obtiene IP: el login se queda sin límite por IP y la
 * auditoría sin IP, y sin el aviso el operador creería tenerlos activos. El aviso no
 * incluye la cabecera ni ninguna IP (son datos personales).
 */
export function pickClientIp(xff: string | null, hops: number): string | null {
  const { ip, problem } = resolveClientIp(xff, hops);
  if (problem && !warnedProblems.has(problem)) {
    warnedProblems.add(problem);
    const values = xff ? xff.split(",").length : 0;
    console.warn(
      `[client-ip] TRUSTED_PROXY_HOPS=${hops} pero ${PROBLEM_DETAIL[problem]} ` +
        `(${values} valores): el login no tiene límite por IP y la auditoría no guarda ` +
        `la IP. Revisa la configuración del proxy. Solo se avisa una vez por motivo y proceso.`,
    );
  }
  return ip;
}
