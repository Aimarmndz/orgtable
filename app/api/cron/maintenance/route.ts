import { purgeExpiredData } from "@/app/lib/services/maintenance";
import { apiOk } from "@/app/lib/api/respond";
import { rejectUnauthorizedCron } from "@/app/lib/api/cron";

// Purge of expired data: audit log older than ORGTABLE_AUDIT_RETENTION_DAYS, sessions
// ended or expired more than 30 days ago and notifications older than 180 days. Once a
// day is enough. Same secret as the reminders:
//
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-instance/api/cron/maintenance
//
// See docs/privacy.md (retention periods) and docs/operations.md (how to schedule it).

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const rejected = rejectUnauthorizedCron(request);
  if (rejected) return rejected;

  const result = await purgeExpiredData(new Date());
  return apiOk(result);
}
