import { apiOk } from "@/app/lib/api/respond";
import { rejectUnauthorizedCron } from "@/app/lib/api/cron";
import { processDeliveries } from "@/app/lib/webhooks/dispatch";

// Retries of webhook deliveries (docs/webhooks.md). Events are sent right away when they
// happen; this endpoint sends the ones waiting for a retry. Schedule it every minute with the
// same CRON_SECRET as the other cron endpoints:
//
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-instance/api/cron/webhooks

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const rejected = rejectUnauthorizedCron(request);
  if (rejected) return rejected;
  let sent = 0;
  // Up to 4 batches per call, so a backlog drains without one call running for minutes.
  for (let i = 0; i < 4; i++) {
    const n = await processDeliveries(undefined, 50);
    sent += n;
    if (n < 50) break;
  }
  return apiOk({ sent });
}
