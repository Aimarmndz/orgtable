import { purgeExpiredData } from "@/app/lib/services/maintenance";
import { apiOk } from "@/app/lib/api/respond";
import { rejectUnauthorizedCron } from "@/app/lib/api/cron";

// Limpieza de datos caducados: auditoría más vieja que ORGTABLE_AUDIT_RETENTION_DAYS,
// sesiones cerradas o caducadas hace más de 30 días y notificaciones de más de 180. Una
// vez al día basta. Mismo secreto que los recordatorios:
//
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://tu-instancia/api/cron/maintenance
//
// Ver docs/privacy.md (plazos) y docs/operations.md (cómo programarlo).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const rejected = rejectUnauthorizedCron(request);
  if (rejected) return rejected;

  const result = await purgeExpiredData(new Date());
  return apiOk(result);
}
