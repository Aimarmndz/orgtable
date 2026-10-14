import { verifySession } from "@/app/lib/dal";
import { prisma } from "@/app/lib/prisma";
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

  // Authorization: valid session + board membership. HTTP status codes (no redirect)
  // because this is a data connection, not a navigation.
  const session = await verifySession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { userId, sessionId } = session;
  const membership = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId } },
    select: { boardId: true },
  });
  if (!membership) return new Response("Forbidden", { status: 403 });

  return createSseResponse({
    signal: request.signal,
    label: "board",
    subscribe: (send) =>
      subscribeBoard(boardId, (event: BoardEvent) => {
        send(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
      }),
    // On every heartbeat: if the session was revoked or the person is no longer a member,
    // the stream is cut (ADR 0008: revocation is immediate, real time included).
    isStillAuthorized: async () => {
      if (!(await isSessionActive(sessionId))) return false;
      const stillMember = await prisma.boardMember.findUnique({
        where: { boardId_userId: { boardId, userId } },
        select: { boardId: true },
      });
      return stillMember !== null;
    },
  });
}
