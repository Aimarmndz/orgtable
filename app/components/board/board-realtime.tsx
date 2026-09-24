"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { keepEventSourceOpen } from "@/app/lib/realtime/reconnect";

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
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Pequeño debounce: si llegan varios eventos seguidos (p. ej. un arrastre), se
    // hace un solo refresh.
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 200);
    };

    const stop = keepEventSourceOpen({
      create: () => new EventSource(`/api/boards/${boardId}/stream`),
      events: { change: onChange },
      // Tras un corte, trae lo que cambió mientras tanto (el servidor no lo reenvía).
      onReconnect: onChange,
      // CLOSED: el navegador no reintentará (401/403 si se revocó la sesión o el
      // acceso, o un 502 del proxy durante un reinicio). El refresh deja que la página
      // redirija a /login o /boards; si no redirige, el helper recrea la fuente.
      onClosed: () => router.refresh(),
    });

    return () => {
      if (timer) clearTimeout(timer);
      stop();
    };
  }, [boardId, router]);

  return null;
}
