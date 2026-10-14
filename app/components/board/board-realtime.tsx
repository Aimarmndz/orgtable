"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  keepEventSourceOpen,
  probeStatus,
  scheduleRefresh,
} from "@/app/lib/realtime/reconnect";

// Live board sync. Opens an EventSource to the board's SSE stream; when a "change" event
// arrives (someone else moved something), asks Next to re-render the server page with
// router.refresh(). BoardView itself resyncs when it receives the new `board`. Events
// emitted during an outage are lost: that is why it also refreshes on reconnect, and if
// the browser stops retrying a new connection is created (see
// app/lib/realtime/reconnect.ts). See app/api/boards/[id]/stream/route.ts and
// docs/realtime.md.
export function BoardRealtime({ boardId }: { boardId: string }) {
  const router = useRouter();

  useEffect(() => {
    const url = `/api/boards/${boardId}/stream`;
    // Small debounce: if several events arrive in a row (e.g. a drag), only one refresh
    // runs. It is shared with the notifications bell: on this page both streams
    // reconnect at once and a single refresh repaints both.
    const onChange = () => scheduleRefresh(() => router.refresh());

    return keepEventSourceOpen({
      create: () => new EventSource(url),
      events: { change: onChange },
      // After an outage, fetch what changed meanwhile (the server does not resend it).
      onReconnect: onChange,
      // CLOSED: ask the endpoint for its status. Only on 401/403 (session or access
      // revoked) refresh so the page redirects to /login or /boards; on a proxy 502
      // during a restart, refreshing would navigate to its error page, so just retry.
      probe: (signal) => probeStatus(url, signal),
      onAccessDenied: onChange,
    });
  }, [boardId, router]);

  return null;
}
