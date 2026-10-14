import { generateDueReminders } from "@/app/lib/services/reminders";
import { apiOk } from "@/app/lib/api/respond";
import { rejectUnauthorizedCron } from "@/app/lib/api/cron";

// Due-date reminders endpoint. Meant to be triggered by an EXTERNAL scheduler (system
// cron, a `docker compose` sidecar, a GitHub Actions schedule, etc.), not an in-process
// timer, in line with not adding infrastructure (ADR 0004). Protected by a shared secret
// in `Authorization: Bearer <CRON_SECRET>`.
//
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-instance/api/cron/reminders
//
// See docs/reminders.md and docs/decisions/0015-reminders-cron.md.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const rejected = rejectUnauthorizedCron(request);
  if (rejected) return rejected;

  const result = await generateDueReminders(new Date());
  return apiOk(result);
}
