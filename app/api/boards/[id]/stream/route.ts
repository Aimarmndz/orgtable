import { verifySession } from "@/app/lib/dal";
import { prisma } from "@/app/lib/prisma";
import { subscribeBoard, type BoardEvent } from "@/app/lib/realtime/bus";
import { createSseResponse, isSessionActive } from "@/app/lib/realtime/sse";

// Stream de eventos (SSE) de un tablero para la sincronización en vivo (Hito 4). El
// navegador abre un EventSource a esta ruta (ver app/components/board/board-realtime.tsx);
// cada vez que alguien muta el tablero, las Server Actions publican un evento en el bus
// y aquí lo reenviamos para que el cliente haga router.refresh(). Ver docs/realtime.md.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: boardId } = await params;

  // Autorización: sesión válida + ser miembro del tablero. Devolvemos códigos HTTP
  // (no redirect) porque es una conexión de datos, no una navegación.
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
    label: "tablero",
    subscribe: (send) =>
      subscribeBoard(boardId, (event: BoardEvent) => {
        send(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
      }),
    // En cada latido: si la sesión se revocó o la persona dejó de ser miembro, se corta
    // el stream (ADR 0008: la revocación es inmediata, también para el tiempo real).
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
