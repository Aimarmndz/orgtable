"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createReconnectRefresher } from "@/app/lib/realtime/reconnect";

// Sincronización en vivo del tablero (Hito 4). Abre un EventSource al stream SSE del
// tablero; cuando llega un evento "change" (otra persona movió algo), pide a Next que
// vuelva a renderizar la página del servidor con router.refresh(). El propio BoardView
// se resincroniza cuando le llega el `board` nuevo. EventSource reconecta solo si la
// conexión se cae, pero los eventos emitidos durante el corte se pierden: por eso al
// reconectar también se refresca. Ver app/api/boards/[id]/stream/route.ts y docs/realtime.md.
export function BoardRealtime({ boardId }: { boardId: string }) {
  const router = useRouter();

  useEffect(() => {
    const source = new EventSource(`/api/boards/${boardId}/stream`);
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Pequeño debounce: si llegan varios eventos seguidos (p. ej. un arrastre), se
    // hace un solo refresh.
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 200);
    };

    // Tras un corte, trae lo que cambió mientras tanto (el servidor no lo reenvía).
    const onOpen = createReconnectRefresher(onChange);
    // CLOSED: el navegador no volverá a intentarlo porque el servidor respondió con
    // error (401/403 si se revocó la sesión o se retiró el acceso). El refresh deja que
    // la página redirija a /login o /boards.
    const onError = () => {
      if (source.readyState === EventSource.CLOSED) router.refresh();
    };

    source.addEventListener("change", onChange);
    source.addEventListener("open", onOpen);
    source.addEventListener("error", onError);

    return () => {
      if (timer) clearTimeout(timer);
      source.removeEventListener("change", onChange);
      source.removeEventListener("open", onOpen);
      source.removeEventListener("error", onError);
      source.close();
    };
  }, [boardId, router]);

  return null;
}
