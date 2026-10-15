import { apiOk } from "@/app/lib/api/respond";
import { rejectUnauthorizedCron } from "@/app/lib/api/cron";
import { runDueBackups } from "@/app/lib/services/backups";

// Scheduled backups (docs/backups.md). Call it every hour with CRON_SECRET; each organization
// (and the instance) is backed up at its own hour, in its own time zone.
//
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-instance/api/cron/backups

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const rejected = rejectUnauthorizedCron(request);
  if (rejected) return rejected;
  return apiOk(await runDueBackups(new Date()));
}
