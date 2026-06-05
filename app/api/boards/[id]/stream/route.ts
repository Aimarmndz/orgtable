import { verifySession } from "@/app/lib/dal";
import { prisma } from "@/app/lib/prisma";
import { subscribeBoard, type BoardEvent } from "@/app/lib/realtime/bus";

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
  const membership = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId: session.userId } },
    select: { boardId: true },
  });
  if (!membership) return new Response("Forbidden", { status: 403 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      // Comentario inicial: abre el stream y fija el intervalo de reconexión del cliente.
      send(": connected\n\n");
      send("retry: 3000\n\n");

      const onEvent = (event: BoardEvent) => {
        send(`event: change\ndata: ${JSON.stringify(event)}\n\n`);
      };
      const unsubscribe = subscribeBoard(boardId, onEvent);

      // Latido periódico para mantener viva la conexión a través de proxies.
      const heartbeat = setInterval(() => send(": ping\n\n"), 25000);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Ya cerrado.
        }
      };

      request.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Desactiva el buffering de nginx para que los eventos lleguen al instante.
      "X-Accel-Buffering": "no",
    },
  });
}
