import "server-only";
import { prisma } from "@/app/lib/prisma";

// Shared lifecycle of the SSE streams (board and notifications). Kept separate so both
// routes share the same cleanup: each used to have its own copy and both left the interval
// and the subscription dangling when `enqueue` failed. See docs/realtime.md.

/** Heartbeat for proxies and, at the same time, when access is checked again. */
export const HEARTBEAT_MS = 25_000;
/**
 * Maximum lifetime of a connection. When it closes, EventSource reconnects and the route
 * authorizes from scratch with the cookie (verifySession), not just the stored session.
 */
export const MAX_STREAM_MS = 15 * 60_000;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // Disables nginx buffering so events arrive at once.
  "X-Accel-Buffering": "no",
} as const;

/**
 * true if the session is still active (neither revoked nor expired). Queries the table
 * directly because there are no cookies outside the initial request: verifySession does
 * not work here.
 */
export async function isSessionActive(sessionId: string): Promise<boolean> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { revokedAt: true, expiresAt: true },
  });
  return (
    session !== null &&
    session.revokedAt === null &&
    session.expiresAt.getTime() > Date.now()
  );
}

export function createSseResponse(opts: {
  signal: AbortSignal;
  /** Label for the logs (no personal data), e.g. "board". */
  label: string;
  /** Subscribes to the bus and returns how to unsubscribe. */
  subscribe: (send: (chunk: string) => void) => () => void;
  /** Called on every heartbeat; when it returns false, the stream closes. */
  isStillAuthorized: () => Promise<boolean>;
}): Response {
  const { signal, label, subscribe, isStillAuthorized } = opts;

  // The client may have left during authorization (the earlier awaits): if the abort
  // already happened, the "abort" listener would never fire and the subscription would
  // stay alive.
  if (signal.aborted) return new Response(null, { status: 204 });

  const encoder = new TextEncoder();
  const openedAt = Date.now();
  let cleaned = false;
  let checking = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;

  // Idempotent: called by the abort, cancel(), a failed enqueue, the access check and the
  // maximum lifetime; any of them may come first.
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe?.();
    signal.removeEventListener("abort", cleanup);
    try {
      controllerRef?.close();
    } catch (err) {
      // After cancel() or a stream error, close() throws: there is nothing left to close.
      if (!(err instanceof TypeError)) {
        console.error(`[realtime] error closing the ${label} SSE stream`, err);
      }
    }
  };

  const send = (chunk: string) => {
    if (cleaned || !controllerRef) return;
    try {
      controllerRef.enqueue(encoder.encode(chunk));
    } catch {
      // The consumer no longer reads (stream closed or cancelled): release everything.
      cleanup();
    }
  };

  const revalidate = () => {
    if (checking || cleaned) return;
    checking = true;
    isStillAuthorized()
      .then((ok) => {
        if (!ok) cleanup();
      })
      .catch((err: unknown) => {
        // Without being able to check access, emitting stops: the client reconnects and
        // the route authorizes again.
        console.error(`[realtime] could not recheck access to the ${label} stream`, err);
        cleanup();
      })
      .finally(() => {
        checking = false;
      });
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      // Initial comment: opens the stream and sets the client's reconnect interval.
      send(": connected\n\n");
      send("retry: 3000\n\n");

      unsubscribe = subscribe(send);
      heartbeat = setInterval(() => {
        if (Date.now() - openedAt >= MAX_STREAM_MS) {
          cleanup();
          return;
        }
        send(": ping\n\n");
        revalidate();
      }, HEARTBEAT_MS);

      signal.addEventListener("abort", cleanup, { once: true });
      if (signal.aborted) cleanup();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
