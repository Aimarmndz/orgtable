import { verifySession } from "@/app/lib/dal";
import { subscribeUser, type UserEvent } from "@/app/lib/realtime/bus";

// Stream SSE de notificaciones del usuario en sesión (Hito 8). El navegador abre un
// EventSource (ver app/components/notifications-bell.tsx); cuando llega una notificación
// nueva, `notify()` publica en el bus y aquí reenviamos un evento para que el cliente
// haga router.refresh() y la campana se actualice. Mismo patrón que el stream de
// tablero. Ver app/api/boards/[id]/stream/route.ts y docs/notifications.md.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  // Es una conexión de datos, no una navegación: devolvemos 401 (no redirect).
  const session = await verifySession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const userId = session.userId;

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

      send(": connected\n\n");
      send("retry: 3000\n\n");

      const onEvent = (event: UserEvent) => {
        send(`event: notification\ndata: ${JSON.stringify(event)}\n\n`);
      };
      const unsubscribe = subscribeUser(userId, onEvent);

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
      "X-Accel-Buffering": "no",
    },
  });
}
