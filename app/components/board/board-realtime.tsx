"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  keepEventSourceOpen,
  probeStatus,
  scheduleRefresh,
} from "@/app/lib/realtime/reconnect";

// Sincronización en vivo del tablero (Hito 4). Abre un EventSource al stream SSE del
// tablero; cuando llega un evento "change" (otra persona movió algo), pide a Next que
// vuelva a renderizar la página del servidor con router.refresh(). El propio BoardView
// se resincroniza cuando le llega el `board` nuevo. Los eventos emitidos durante un
// corte se pierden: por eso al reconectar también se refresca, y si el navegador deja
// de reintentar se crea otra conexión (ver app/lib/realtime/reconnect.ts). Ver
// app/api/boards/[id]/stream/route.ts y docs/realtime.md.
export function BoardRealtime({ boardId }: { boardId: string }) {
  const router = useRouter();

  useEffect(() => {
    const url = `/api/boards/${boardId}/stream`;
    // Pequeño debounce: si llegan varios eventos seguidos (p. ej. un arrastre), se
    // hace un solo refresh. Es compartido con la campana de notificaciones: en esta
    // página los dos streams reconectan a la vez y un refresh ya repinta ambos.
    const onChange = () => scheduleRefresh(() => router.refresh());

    return keepEventSourceOpen({
      create: () => new EventSource(url),
      events: { change: onChange },
      // Tras un corte, trae lo que cambió mientras tanto (el servidor no lo reenvía).
      onReconnect: onChange,
      // CLOSED: se pregunta el estado al endpoint. Solo con 401/403 (sesión o acceso
      // revocados) se refresca para que la página redirija a /login o /boards; ante un
      // 502 del proxy durante un reinicio refrescar navegaría a su página de error, así
      // que solo se reintenta.
      probe: () => probeStatus(url),
      onAccessDenied: onChange,
    });
  }, [boardId, router]);

  return null;
}
