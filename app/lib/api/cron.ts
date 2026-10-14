import "server-only";
import { timingSafeEqual } from "node:crypto";
import { apiError } from "@/app/lib/api/respond";

// Authorization of the cron endpoints (/api/cron/*). They are triggered by an EXTERNAL
// scheduler (system cron, a sidecar, GitHub Actions…), not an in-process timer (ADR 0015),
// with the shared secret in `Authorization: Bearer <CRON_SECRET>`.

// Constant-time comparison so the response time does not leak the secret.
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** null if the request carries the right secret; otherwise, the matching error response. */
export function rejectUnauthorizedCron(request: Request): Response | null {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    // Generic message: configuration details are not revealed to the client.
    return apiError(503, "Service unavailable.");
  }
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided || !secretMatches(provided, expected)) {
    return apiError(401, "Invalid cron secret.");
  }
  return null;
}
