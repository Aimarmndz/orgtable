import { receiveIncomingCard } from "@/app/lib/services/incoming-hooks";
import { rateLimit } from "@/app/lib/rate-limit";
import { apiError, apiOk } from "@/app/lib/api/respond";

// POST /api/hooks/in/<token>: an incoming webhook creates a card (docs/webhooks.md). The
// secret is the URL itself; there is no session or API token. Up to 60 cards a minute per
// URL and 64 KB per request.
//
//   curl -X POST https://your-instance/api/hooks/in/inb_… \
//     -H 'content-type: application/json' -d '{"title":"Call Hotel Mar","labels":["lead"]}'

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY = 64 * 1024;
const PER_MINUTE = 60;

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) return apiError(413, "The body can be up to 64 KB.");
  const text = await request.text();
  if (text.length > MAX_BODY) return apiError(413, "The body can be up to 64 KB.");
  // Per URL (the token's start is enough to tell them apart, and is not the secret).
  if (!rateLimit(`incoming:${token.slice(0, 16)}`, PER_MINUTE, 60_000).ok) {
    return apiError(429, "Too many cards for this URL. Try again in a minute.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return apiError(400, "The body must be JSON.");
  }
  const result = await receiveIncomingCard(token, payload);
  if (!result.ok) return apiError(result.status, result.error);
  return apiOk({ id: result.cardId }, 201);
}
