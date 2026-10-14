// Resync when an EventSource reconnects (board and notification bell).
//
// The server does not resend missed events (no Last-Event-ID or history): whatever changed
// while the connection was down (laptop sleep, server restart, network cut) never arrives.
// So every time the EventSource opens again AFTER the first time, a refresh is requested
// to fetch the current state. Not needed on the first open: the page was just rendered
// with fresh data.

// A single refresh per tab. router.refresh() re-renders the whole route tree, layout
// included: on /board/[id] the bell (layout) and BoardRealtime (page) each have their own
// EventSource, which the server cuts at the same time (15 min maximum lifetime, restart,
// laptop sleep). With a per-component debounce each reconnect cost two full board renders;
// with this module-level timer, requests from both within the window are merged.
export const REFRESH_DEBOUNCE_MS = 200;
let pendingRefresh: ReturnType<typeof setTimeout> | null = null;

/**
 * Schedules a refresh merged with those requested by any component in the next
 * REFRESH_DEBOUNCE_MS. Not cancelled on unmount: the timer is shared and cancelling it
 * would drop the refresh the other component asked for; a router.refresh() after unmount
 * only refreshes the current route, with no harmful effects.
 */
export function scheduleRefresh(refresh: () => void): void {
  if (pendingRefresh) clearTimeout(pendingRefresh);
  pendingRefresh = setTimeout(() => {
    pendingRefresh = null;
    refresh();
  }, REFRESH_DEBOUNCE_MS);
}

/** Returns the "open" handler: ignores the first open and signals the following ones. */
export function createReconnectRefresher(onReconnect: () => void): () => void {
  let opened = false;
  return () => {
    if (opened) onReconnect();
    opened = true;
  };
}

// Retry when the browser gives up. EventSource reconnects on its own if the response was
// 200 or the connection was cut; on any other status (e.g. a TLS proxy's 502 while
// scripts/update.sh restarts the app, or a 401/403) it stays CLOSED forever and live
// updates were silently lost until the tab was reloaded. Hence a new EventSource is
// created with exponential backoff from 3 s to 30 s.
//
// EventSource does not expose the HTTP status, so once CLOSED the same endpoint is asked
// (probeStatus) and access denied is only reported on 401/403. A blind router.refresh()
// is not possible: in Next 16, if the refresh's RSC request gets a non-OK response or a
// network error, the router does a full navigation (see fetch-server-response.js,
// doMpaNavigation) and the tab ended up on the proxy's "502 Bad Gateway" page, losing
// anything unsaved.
export const RETRY_BASE_MS = 3_000;
export const RETRY_MAX_MS = 30_000;

// Maximum time for the check. fetch has no timeout in the browser: if the proxy holds the
// connection while the app starts, or verifySession waits for a pool connection during the
// same database failure that caused the 500, the check would never answer and, since the
// retry is scheduled when it ends, the source would never be recreated.
export const PROBE_TIMEOUT_MS = 10_000;

// Value of EventSource.CLOSED. The literal is used because the EventSource global does
// not exist in Node (tests).
const CLOSED = 2;

/** Wait before retry number `attempt` (0, 1, 2…): 3 s, 6 s, 12 s, 24 s, 30 s… */
export function retryDelay(attempt: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
}

/** What the helper uses from an EventSource (lets it be tested without a browser). */
export type EventSourceLike = {
  readonly readyState: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  close(): void;
};

/**
 * HTTP status of the SSE endpoint, or null without a response (network error, server
 * down, or `signal` aborted by the timeout or unmount). It is a plain GET aborted as soon
 * as the headers arrive: with a 200 the stream opens and closes at once (the server
 * cleans up the subscription on abort). HEAD is not used because in the App Router it is
 * derived from GET and would open the stream anyway.
 */
export async function probeStatus(url: string, signal?: AbortSignal): Promise<number | null> {
  const controller = new AbortController();
  // Chained by hand instead of AbortSignal.any, which Safari only has since 17.4.
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) return null;
  signal?.addEventListener("abort", forwardAbort, { once: true });
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });
    return res.status;
  } catch (err) {
    // No response, no status to interpret: the caller retries with backoff. Only a
    // network failure (fetch's TypeError) and an abort requested from outside are
    // tolerated; any other error is a bug.
    if (err instanceof TypeError || controller.signal.aborted) return null;
    throw err;
  } finally {
    signal?.removeEventListener("abort", forwardAbort);
    controller.abort();
  }
}

/**
 * Keeps an EventSource open while the component is mounted and returns the cleanup
 * function for the effect.
 * - `events`: handlers by SSE event name.
 * - `onReconnect`: called on every open except the first (recreated sources included),
 *   to fetch what was missed during the outage.
 * - `probe`: when the browser leaves the source CLOSED, finds out the endpoint's HTTP
 *   status (probeStatus in the app; injectable to test without a browser). It gets a
 *   signal aborted after PROBE_TIMEOUT_MS or on unmount; even if `probe` ignores it, the
 *   retry happens after the timeout as on a network error.
 * - `onAccessDenied`: only when `probe` gives 401/403 (session or access revoked); with a
 *   `router.refresh()` the page redirects and unmounting cancels the retry. Not called on
 *   a 5xx or a network error: it just retries, and on reopening `onReconnect` resyncs with
 *   the healthy server.
 */
export function keepEventSourceOpen(options: {
  create: () => EventSourceLike;
  events: Record<string, () => void>;
  onReconnect: () => void;
  probe: (signal: AbortSignal) => Promise<number | null>;
  onAccessDenied: () => void;
}): () => void {
  const { create, events, onReconnect, probe, onAccessDenied } = options;
  // A single instance for all sources: the first open of a recreated source is a
  // reconnect.
  const refreshOnReopen = createReconnectRefresher(onReconnect);
  let source: EventSourceLike | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let probeTimer: ReturnType<typeof setTimeout> | null = null;
  let probeController: AbortController | null = null;
  let attempt = 0;
  let stopped = false;

  const onOpen = () => {
    attempt = 0;
    refreshOnReopen();
  };

  const detach = (s: EventSourceLike) => {
    for (const [type, listener] of Object.entries(events)) {
      s.removeEventListener(type, listener);
    }
    s.removeEventListener("open", onOpen);
    s.removeEventListener("error", onError);
    s.close();
  };

  function onError() {
    if (!source || source.readyState !== CLOSED || stopped) return;
    detach(source);
    source = null;
    const delay = retryDelay(attempt);
    attempt += 1;
    const controller = new AbortController();
    probeController = controller;
    // The timeout races the check instead of trusting `probe` to honour the signal: the
    // retry must be scheduled no matter what.
    const timedOut = new Promise<null>((resolve) => {
      probeTimer = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, PROBE_TIMEOUT_MS);
    });
    const checked = probe(controller.signal).catch((err: unknown) => {
      // Aborted by the timeout or unmount: the reason is known, it is not a failure.
      if (controller.signal.aborted) return null;
      // If it is unknown why it closed, do not refresh (it could navigate to an error
      // page): retry as on a 5xx.
      console.error("[realtime] could not check why the stream closed", err);
      return null;
    });
    void Promise.race([checked, timedOut]).then((status) => {
      if (probeTimer) clearTimeout(probeTimer);
      probeTimer = null;
      probeController = null;
      // The component may have unmounted during the check.
      if (stopped) return;
      if (status === 401 || status === 403) onAccessDenied();
      retryTimer = setTimeout(connect, delay);
    });
  }

  function connect() {
    retryTimer = null;
    if (stopped) return;
    const s = create();
    for (const [type, listener] of Object.entries(events)) {
      s.addEventListener(type, listener);
    }
    s.addEventListener("open", onOpen);
    s.addEventListener("error", onError);
    source = s;
  }

  connect();

  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    // Aborts the ongoing check so the request is not left hanging after unmount.
    if (probeTimer) clearTimeout(probeTimer);
    probeTimer = null;
    probeController?.abort();
    probeController = null;
    if (source) detach(source);
    source = null;
  };
}
