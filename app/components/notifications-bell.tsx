"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createReconnectRefresher } from "@/app/lib/realtime/reconnect";
import {
  markNotificationRead,
  markAllNotificationsRead,
} from "@/app/lib/actions/notifications";

export type NotificationDTO = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  boardId: string | null;
  cardId: string | null;
  read: boolean;
  createdAt: string; // ISO
};

// Tiempo relativo legible en español, calculado en cliente.
function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  const min = Math.floor((Date.now() - then) / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ayer";
  if (d < 7) return `hace ${d} d`;
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "short",
  }).format(then);
}

// Campana de notificaciones (Hito 8). Recibe los datos del servidor (renderizados en el
// layout) y se mantiene viva con un EventSource al stream del usuario: cuando llega una
// notificación nueva, hace router.refresh() para repintar con datos frescos. El estado
// de "abierto" es local y sobrevive al refresh. Ver docs/notifications.md.
export function NotificationsBell({
  notifications,
  unreadCount,
}: {
  notifications: NotificationDTO[];
  unreadCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  // Entrega en vivo: refresca (con un pequeño debounce) cuando el bus avisa.
  useEffect(() => {
    const source = new EventSource("/api/notifications/stream");
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onEvent = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 200);
    };
    // Al reconectar, trae las notificaciones que llegaron durante el corte (el servidor
    // no las reenvía). Ver app/lib/realtime/reconnect.ts.
    const onOpen = createReconnectRefresher(onEvent);
    // CLOSED: el servidor rechazó la conexión (401 si se revocó la sesión) y el
    // navegador no reintentará; el refresh deja que el layout redirija a /login.
    const onError = () => {
      if (source.readyState === EventSource.CLOSED) router.refresh();
    };
    source.addEventListener("notification", onEvent);
    source.addEventListener("open", onOpen);
    source.addEventListener("error", onError);
    return () => {
      if (timer) clearTimeout(timer);
      source.removeEventListener("notification", onEvent);
      source.removeEventListener("open", onOpen);
      source.removeEventListener("error", onError);
      source.close();
    };
  }, [router]);

  // Cierra con Escape (setOpen es estable, no hace falta ref).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openItem = (n: NotificationDTO) => {
    setOpen(false);
    if (!n.read) {
      // La acción llama a refresh() de next/cache: el contador se actualiza también
      // cuando además se navega al tablero (antes solo se refrescaba sin tablero).
      startTransition(async () => {
        await markNotificationRead(n.id);
      });
    }
    if (n.boardId) {
      // Si la notificación apunta a una tarjeta, la abre directamente (deep-link ?card=).
      const href = n.cardId
        ? `/board/${n.boardId}?card=${n.cardId}`
        : `/board/${n.boardId}`;
      router.push(href);
    }
  };

  const markAll = () => {
    startTransition(async () => {
      await markAllNotificationsRead();
    });
  };

  const badge = unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          unreadCount > 0
            ? `Notificaciones (${unreadCount} sin leer)`
            : "Notificaciones"
        }
        aria-expanded={open}
        className="relative grid size-9 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <svg
          className="size-[18px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 font-mono text-[10px] font-bold leading-4 text-accent-ink tabular-nums">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Capa para cerrar al pulsar fuera. */}
          <div
            className="fixed inset-0 z-30"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Notificaciones"
            className="absolute right-0 top-11 z-40 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-[0_24px_48px_-24px_oklch(0.27_0.022_52/0.4)]"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-display text-sm font-bold tracking-tight">
                Notificaciones
              </h2>
              {unreadCount > 0 && (
                <button
                  onClick={markAll}
                  className="text-xs font-medium text-accent transition-colors hover:text-accent-hover"
                >
                  Marcar todas
                </button>
              )}
            </div>

            {notifications.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-ink-muted">
                No tienes notificaciones.
              </p>
            ) : (
              <ul className="max-h-96 divide-y divide-border overflow-y-auto">
                {notifications.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => openItem(n)}
                      className={`flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors hover:bg-surface-2 ${
                        n.read ? "" : "bg-accent/[0.06]"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${
                          n.read ? "bg-transparent" : "bg-accent"
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm leading-snug">
                          {n.title}
                        </span>
                        {n.body && (
                          <span className="mt-0.5 block text-xs text-ink-muted">
                            {n.body}
                          </span>
                        )}
                        <span className="mt-1 block text-[11px] text-ink-muted/80">
                          {relTime(n.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
