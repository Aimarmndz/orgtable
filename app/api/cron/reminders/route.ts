import { generateDueReminders } from "@/app/lib/services/reminders";
import { apiOk } from "@/app/lib/api/respond";
import { rejectUnauthorizedCron } from "@/app/lib/api/cron";

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

export async function POST(request: Request): Promise<Response> {
  const rejected = rejectUnauthorizedCron(request);
  if (rejected) return rejected;

  const result = await generateDueReminders(new Date());
  return apiOk(result);
}
