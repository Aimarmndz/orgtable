import { verifySession } from "@/app/lib/dal";
import { effectiveBoardRole } from "@/app/lib/access";
import { subscribeBoard, type BoardEvent } from "@/app/lib/realtime/bus";
import { createSseResponse, isSessionActive } from "@/app/lib/realtime/sse";

// Event stream (SSE) of a board for live sync. The browser opens an EventSource to this
// route (see app/components/board/board-realtime.tsx); whenever someone changes the board,
// the Server Actions publish an event on the bus and we forward it here so the client
// calls router.refresh(). See docs/realtime.md.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: boardId } = await params;

  // Authorization: valid session + access to the board (app/lib/access.ts). HTTP status codes (no redirect)
  // because this is a data connection, not a navigation.
  const session = await verifySession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { userId, sessionId } = session;
  if (!(await effectiveBoardRole(boardId, userId))) {
    return new Response("Forbidden", { status: 403 });
  }

  return createSseResponse({
    signal: request.signal,
    label: "board",
    subscribe: (send) =>
      subscribeBoard(boardId, (event: BoardEvent) => {
        send(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
      }),
    // On every heartbeat: if the session was revoked or the person lost access (removed
    // from the board or its workspace, workspace suspended), the stream is cut (ADR 0008: revocation is immediate, real time included).
    isStillAuthorized: async () => {
      if (!(await isSessionActive(sessionId))) return false;
      return (await effectiveBoardRole(boardId, userId)) !== null;
    },
  });
}
