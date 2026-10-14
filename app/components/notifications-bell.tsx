"use client";

import {
  useEffect,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  keepEventSourceOpen,
  probeStatus,
  scheduleRefresh,
} from "@/app/lib/realtime/reconnect";
import {
  markNotificationRead,
  markAllNotificationsRead,
} from "@/app/lib/actions/notifications";
import { useI18n } from "@/app/i18n/client";
import { fmt } from "@/app/i18n/format";
import type { Messages } from "@/app/i18n/config";

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

// Readable relative time. It depends on the browser's clock and time zone, so it is only
// rendered after mounting (see useMounted): during SSR it would produce different text
// and React would warn about a hydration mismatch.
function relTime(
  iso: string,
  t: Messages["nav"]["notifications"]["time"],
  intl: string,
): string {
  const then = new Date(iso).getTime();
  const min = Math.floor((Date.now() - then) / 60000);
  if (min < 1) return t.now;
  if (min < 60) return fmt(t.minutes, { count: min });
  const h = Math.floor(min / 60);
  if (h < 24) return fmt(t.hours, { count: h });
  const d = Math.floor(h / 24);
  if (d === 1) return t.yesterday;
  if (d < 7) return fmt(t.days, { count: d });
  return new Intl.DateTimeFormat(intl, {
    day: "numeric",
    month: "short",
  }).format(then);
}

const noopSubscribe = () => () => {};

// false on the server and during hydration, true once mounted on the client.
function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

// Notifications bell. Gets its data from the server (rendered in the layout) and stays
// live with an EventSource on the user's stream: when a new notification arrives it calls
// router.refresh() to repaint with fresh data. The "open" state is local and survives the
// refresh. Titles and bodies are stored data, shown as they are. See docs/notifications.md.
export function NotificationsBell({
  notifications,
  unreadCount,
}: {
  notifications: NotificationDTO[];
  unreadCount: number;
}) {
  const router = useRouter();
  const { m, intl } = useI18n();
  const t = m.nav.notifications;
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();
  const mounted = useMounted();

  // Live delivery: refresh (slightly debounced) when the bus says so. The debounce is
  // shared with BoardRealtime (scheduleRefresh): on the board page both streams drop and
  // come back together, and a single refresh repaints both.
  useEffect(() => {
    const url = "/api/notifications/stream";
    const onEvent = () => scheduleRefresh(() => router.refresh());
    return keepEventSourceOpen({
      create: () => new EventSource(url),
      events: { notification: onEvent },
      // On reconnect, fetch the notifications that arrived during the outage (the server
      // does not resend them). See app/lib/realtime/reconnect.ts.
      onReconnect: onEvent,
      // CLOSED: ask the endpoint for its status. Only a 401 (revoked session) refreshes,
      // so the layout redirects to /login; on a proxy 502 during a restart a refresh would
      // land on its error page, so it just retries.
      probe: (signal) => probeStatus(url, signal),
      onAccessDenied: onEvent,
    });
  }, [router]);

  // Close on Escape (setOpen is stable, no ref needed).
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
      // The action calls refresh() from next/cache, so the counter also updates when we
      // navigate to the board as well.
      startTransition(async () => {
        await markNotificationRead(n.id);
      });
    }
    if (n.boardId) {
      // If the notification points to a card, open it directly (?card= deep link).
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
          unreadCount > 0 ? fmt(t.labelUnread, { count: unreadCount }) : t.title
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
          {/* Backdrop that closes the panel on outside click. */}
          <div
            className="fixed inset-0 z-30"
            aria-hidden
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label={t.title}
            className="absolute right-0 top-11 z-40 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-[0_24px_48px_-24px_oklch(0.27_0.022_52/0.4)]"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-display text-sm font-bold tracking-tight">
                {t.title}
              </h2>
              {unreadCount > 0 && (
                <button
                  onClick={markAll}
                  className="text-xs font-medium text-accent transition-colors hover:text-accent-hover"
                >
                  {t.markAll}
                </button>
              )}
            </div>

            {notifications.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-ink-muted">
                {t.empty}
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
                        <time
                          dateTime={n.createdAt}
                          className="mt-1 block text-[11px] text-ink-muted/80"
                        >
                          {mounted ? relTime(n.createdAt, t.time, intl) : ""}
                        </time>
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
