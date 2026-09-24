import { verifySession } from "@/app/lib/dal";
import { subscribeUser, type UserEvent } from "@/app/lib/realtime/bus";
import { createSseResponse, isSessionActive } from "@/app/lib/realtime/sse";

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
  const { userId, sessionId } = session;

  return createSseResponse({
    signal: request.signal,
    label: "notificaciones",
    subscribe: (send) =>
      subscribeUser(userId, (event: UserEvent) => {
        send(`event: notification\ndata: ${JSON.stringify(event)}\n\n`);
      }),
    // Una sesión revocada deja de recibir avisos en el siguiente latido.
    isStillAuthorized: () => isSessionActive(sessionId),
  });
}
