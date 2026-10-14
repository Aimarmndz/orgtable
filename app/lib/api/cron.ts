import "server-only";
import { timingSafeEqual } from "node:crypto";
import { apiError } from "@/app/lib/api/respond";

// Autorización de los endpoints de cron (/api/cron/*). Los dispara un programador
// EXTERNO (cron del sistema, un sidecar, GitHub Actions…), no un timer en proceso
// (ADR 0015), con el secreto compartido en `Authorization: Bearer <CRON_SECRET>`.

// Comparación en tiempo constante para no filtrar el secreto por el tiempo de respuesta.
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** null si la petición trae el secreto correcto; si no, la respuesta de error que toca. */
export function rejectUnauthorizedCron(request: Request): Response | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Mensaje genérico: no revelamos detalles de configuración al cliente.
    return apiError(503, "Servicio no disponible.");
  }
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided || !secretMatches(provided, expected)) {
    return apiError(401, "Secreto de cron no válido.");
  }
  return null;
}
