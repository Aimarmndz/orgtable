"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Sincronización en vivo del tablero (Hito 4). Abre un EventSource al stream SSE del
// tablero; cuando llega un evento "change" (otra persona movió algo), pide a Next que
// vuelva a renderizar la página del servidor con router.refresh(). El propio BoardView
// se resincroniza cuando le llega el `board` nuevo. EventSource reconecta solo si la
// conexión se cae. Ver app/api/boards/[id]/stream/route.ts y docs/realtime.md.
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

    source.addEventListener("change", onChange);

    return () => {
      if (timer) clearTimeout(timer);
      source.removeEventListener("change", onChange);
      source.close();
    };
  }, [boardId, router]);

  return null;
}
