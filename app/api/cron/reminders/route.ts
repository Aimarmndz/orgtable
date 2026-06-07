import { timingSafeEqual } from "node:crypto";
import { generateDueReminders } from "@/app/lib/services/reminders";
import { apiError, apiOk } from "@/app/lib/api/respond";

// Endpoint de recordatorios de vencimiento (Hito 11). Pensado para que lo dispare un
// programador EXTERNO (cron del sistema, `docker compose` con un sidecar, GitHub Actions
// schedule, etc.), no un timer en proceso — coherente con no añadir infraestructura
// (ADR 0004). Se protege con un secreto compartido en `Authorization: Bearer <CRON_SECRET>`.
//
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://tu-instancia/api/cron/reminders
//
// Ver docs/reminders.md y docs/decisions/0015-reminders-cron.md.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Comparación en tiempo constante para no filtrar el secreto por el tiempo de respuesta.
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return apiError(503, "Los recordatorios están desactivados (sin CRON_SECRET).");
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided || !secretMatches(provided, expected)) {
    return apiError(401, "Secreto de cron no válido.");
  }

  const result = await generateDueReminders(new Date());
  return apiOk(result);
}
