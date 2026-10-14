import { verifySession } from "@/app/lib/dal";
import { subscribeUser, type UserEvent } from "@/app/lib/realtime/bus";
import { createSseResponse, isSessionActive } from "@/app/lib/realtime/sse";

// SSE stream of the signed-in user's notifications. The browser opens an EventSource
// (see app/components/notifications-bell.tsx); when a new notification arrives,
// `notify()` publishes on the bus and we forward an event here so the client calls
// router.refresh() and the bell updates. Same pattern as the board stream. See
// app/api/boards/[id]/stream/route.ts and docs/notifications.md.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  // A data connection, not a navigation: answer 401 (no redirect).
  const session = await verifySession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { userId, sessionId } = session;

  return createSseResponse({
    signal: request.signal,
    label: "notifications",
    subscribe: (send) =>
      subscribeUser(userId, (event: UserEvent) => {
        send(`event: notification\ndata: ${JSON.stringify(event)}\n\n`);
      }),
    // A revoked session stops receiving events on the next heartbeat.
    isStillAuthorized: () => isSessionActive(sessionId),
  });
}
