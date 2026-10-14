import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createReconnectRefresher,
  keepEventSourceOpen,
  probeStatus,
  retryDelay,
  scheduleRefresh,
  PROBE_TIMEOUT_MS,
  REFRESH_DEBOUNCE_MS,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
} from "@/app/lib/realtime/reconnect";

// Regression: after an EventSource drop, changes made in the meantime never arrived
// because the server does not resend events. Now every reopening refreshes.
describe("createReconnectRefresher", () => {
  it("does not refresh on the first opening", () => {
    const onReconnect = vi.fn();
    const onOpen = createReconnectRefresher(onReconnect);
    onOpen();
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("refreshes on every later reopening", () => {
    const onReconnect = vi.fn();
    const onOpen = createReconnectRefresher(onReconnect);
    onOpen();
    onOpen();
    onOpen();
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });

  it("each EventSource keeps its own state", () => {
    const a = vi.fn();
    const b = vi.fn();
    const onOpenA = createReconnectRefresher(a);
    const onOpenB = createReconnectRefresher(b);
    onOpenA();
    onOpenA();
    onOpenB();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });
});

// EventSource double: records the handlers and lets the test simulate open/error/CLOSED.
class FakeSource {
  readyState = 0;
  closed = false;
  private listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(type: string) {
    for (const l of [...(this.listeners.get(type) ?? [])]) l();
  }
  open() {
    this.readyState = 1;
    this.emit("open");
  }
  // The browser gives up (non-200 response, e.g. a 502 from the proxy): CLOSED + error.
  fail() {
    this.readyState = 2;
    this.emit("error");
  }
  // Transient drop: the browser will retry on its own (CONNECTING + error).
  drop() {
    this.readyState = 0;
    this.emit("error");
  }
  listenerCount() {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}

// `status`: what the endpoint would answer when checking why the source closed.
function setup(status: number | null = 502) {
  const sources: FakeSource[] = [];
  const onEvent = vi.fn();
  const onReconnect = vi.fn();
  const onAccessDenied = vi.fn();
  const probe = vi.fn<(signal: AbortSignal) => Promise<number | null>>(async () => status);
  const stop = keepEventSourceOpen({
    create: () => {
      const s = new FakeSource();
      sources.push(s);
      return s;
    },
    events: { change: onEvent },
    onReconnect,
    probe,
    onAccessDenied,
  });
  return { sources, onEvent, onReconnect, onAccessDenied, probe, stop };
}

// Lets the `probe` promise resolve without advancing the clock.
const flush = () => vi.advanceTimersByTimeAsync(0);

describe("retryDelay", () => {
  it("doubles from 3 s up to a maximum of 30 s", () => {
    expect([0, 1, 2, 3, 4, 10].map(retryDelay)).toEqual([
      3_000, 6_000, 12_000, 24_000, 30_000, 30_000,
    ]);
  });
});

// Regression: with a 502 from the proxy during a restart the EventSource stayed CLOSED and
// nobody created another one; realtime was lost until the tab was reloaded.
describe("keepEventSourceOpen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("forwards SSE events to the handler", () => {
    const { sources, onEvent, stop } = setup();
    sources[0].open();
    sources[0].emit("change");
    expect(onEvent).toHaveBeenCalledTimes(1);
    stop();
  });

  it("recreates the source after CLOSED with backoff and refreshes on reopening", async () => {
    const { sources, onReconnect, onAccessDenied, probe, stop } = setup(502);
    sources[0].open();
    expect(onReconnect).not.toHaveBeenCalled();

    sources[0].fail();
    expect(sources[0].closed).toBe(true);
    expect(sources[0].listenerCount()).toBe(0);
    await flush();
    expect(probe).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RETRY_BASE_MS - 1);
    expect(sources).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sources).toHaveLength(2);

    // The server is still down: the next attempt waits twice as long.
    sources[1].fail();
    await flush();
    vi.advanceTimersByTime(2 * RETRY_BASE_MS - 1);
    expect(sources).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sources).toHaveLength(3);

    // It comes back: the first opening of the recreated source is a reconnection.
    sources[2].open();
    expect(onReconnect).toHaveBeenCalledTimes(1);

    // After opening, the backoff starts again at 3 s.
    sources[2].fail();
    await flush();
    vi.advanceTimersByTime(RETRY_BASE_MS);
    expect(sources).toHaveLength(4);
    expect(onAccessDenied).not.toHaveBeenCalled();
    stop();
  });

  // Regression: with a 502 from the proxy (or a 500 from a transient DB failure) it called
  // router.refresh(); in Next 16 a refresh with a non-OK response navigates to the error
  // page and the tab lost the app. Now a 5xx or a network error only retries.
  it.each([500, 502, 503, null])(
    "on %s it does not report access denied and retries",
    async (status) => {
      const { sources, onAccessDenied, stop } = setup(status);
      sources[0].fail();
      await flush();
      expect(onAccessDenied).not.toHaveBeenCalled();
      vi.advanceTimersByTime(RETRY_BASE_MS);
      expect(sources).toHaveLength(2);
      stop();
    },
  );

  it.each([401, 403])(
    "on %s it reports access denied (to redirect) and retries",
    async (status) => {
      const { sources, onAccessDenied, stop } = setup(status);
      sources[0].fail();
      await flush();
      expect(onAccessDenied).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(RETRY_BASE_MS);
      expect(sources).toHaveLength(2);
      stop();
    },
  );

  it("if the check fails, it retries without reporting access denied", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sources: FakeSource[] = [];
    const onAccessDenied = vi.fn();
    const stop = keepEventSourceOpen({
      create: () => {
        const s = new FakeSource();
        sources.push(s);
        return s;
      },
      events: {},
      onReconnect: () => {},
      probe: () => Promise.reject(new Error("unexpected failure")),
      onAccessDenied,
    });
    sources[0].fail();
    await flush();
    expect(onAccessDenied).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(RETRY_BASE_MS);
    expect(sources).toHaveLength(2);
    stop();
    errorSpy.mockRestore();
  });

  it("neither retries nor reports if it unmounts while the status is being checked", async () => {
    const { sources, onAccessDenied, stop } = setup(401);
    sources[0].fail();
    stop();
    await flush();
    vi.advanceTimersByTime(RETRY_MAX_MS);
    expect(onAccessDenied).not.toHaveBeenCalled();
    expect(sources).toHaveLength(1);
  });

  // Regression: the retry was only scheduled when the check finished; if the proxy held
  // the connection or the server never answered, the source was never recreated and
  // realtime was lost until the tab was reloaded.
  it("if the check does not answer, it retries after the timeout without reporting", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sources: FakeSource[] = [];
    const onAccessDenied = vi.fn();
    const signals: AbortSignal[] = [];
    const stop = keepEventSourceOpen({
      create: () => {
        const s = new FakeSource();
        sources.push(s);
        return s;
      },
      events: {},
      onReconnect: () => {},
      // Ignores the signal on purpose: the timeout cannot depend on it being honoured.
      probe: (signal) => {
        signals.push(signal);
        return new Promise<number | null>(() => {});
      },
      onAccessDenied,
    });
    sources[0].fail();
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS - 1);
    expect(signals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0].aborted).toBe(true);
    vi.advanceTimersByTime(RETRY_BASE_MS);
    expect(sources).toHaveLength(2);
    expect(onAccessDenied).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    stop();
    errorSpy.mockRestore();
  });

  it("unmounting aborts the check in progress", async () => {
    const { sources, probe, stop } = setup(502);
    sources[0].fail();
    const signal = probe.mock.calls[0][0];
    expect(signal.aborted).toBe(false);
    stop();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS + RETRY_MAX_MS);
    expect(sources).toHaveLength(1);
  });

  it("does not recreate the source on a drop the browser retries on its own", async () => {
    const { sources, probe, onReconnect, stop } = setup();
    sources[0].open();
    sources[0].drop();
    await flush();
    vi.advanceTimersByTime(RETRY_MAX_MS);
    expect(probe).not.toHaveBeenCalled();
    expect(sources).toHaveLength(1);
    sources[0].open();
    expect(onReconnect).toHaveBeenCalledTimes(1);
    stop();
  });

  it("cleanup closes the source and cancels the pending retry", async () => {
    const { sources, stop } = setup();
    sources[0].fail();
    await flush();
    stop();
    vi.advanceTimersByTime(RETRY_MAX_MS);
    expect(sources).toHaveLength(1);

    const second = setup();
    second.sources[0].open();
    second.stop();
    expect(second.sources[0].closed).toBe(true);
    expect(second.sources[0].listenerCount()).toBe(0);
  });
});

// Regression: on /board/[id] the bell and the board reconnect at the same time and each
// fired its own router.refresh(); two full renders of the board instead of one.
describe("scheduleRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("groups the requests of several components into a single refresh", () => {
    const refreshBoard = vi.fn();
    const refreshBell = vi.fn();
    scheduleRefresh(refreshBoard);
    scheduleRefresh(refreshBell);
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    expect(refreshBoard.mock.calls.length + refreshBell.mock.calls.length).toBe(1);
  });

  it("refreshes again if the request arrives outside the window", () => {
    const refresh = vi.fn();
    scheduleRefresh(refresh);
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    scheduleRefresh(refresh);
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});

// With a real HTTP server: the status has to arrive without waiting for the body (an SSE
// stream never ends) and the connection must be closed right away.
describe("probeStatus", () => {
  let server: Server;
  let base: string;
  let streamClosed: Promise<void>;

  beforeEach(async () => {
    let markClosed: () => void = () => {};
    streamClosed = new Promise((resolve) => {
      markClosed = resolve;
    });
    server = createServer((req, res) => {
      if (req.url === "/401") {
        res.writeHead(401).end("Unauthorized");
        return;
      }
      if (req.url === "/502") {
        res.writeHead(502).end("Bad Gateway");
        return;
      }
      // A proxy that holds the connection without sending headers.
      if (req.url === "/hang") {
        res.on("close", markClosed);
        return;
      }
      // An SSE stream that does not close on its own.
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(": connected\n\n");
      res.on("close", markClosed);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns the endpoint's error status", async () => {
    expect(await probeStatus(`${base}/401`)).toBe(401);
    expect(await probeStatus(`${base}/502`)).toBe(502);
  });

  it("with an open stream it returns 200 and cuts the connection", async () => {
    expect(await probeStatus(`${base}/stream`)).toBe(200);
    await streamClosed;
  });

  it("if the signal is aborted before the response it returns null and cuts", async () => {
    const controller = new AbortController();
    const pending = probeStatus(`${base}/hang`, controller.signal);
    setTimeout(() => controller.abort(), 50);
    expect(await pending).toBeNull();
    await streamClosed;
  });

  it("with an already aborted signal it returns null without making the request", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await probeStatus(`${base}/401`, controller.signal)).toBeNull();
  });

  it("without a response (server down) it returns null", async () => {
    const port = (server.address() as AddressInfo).port;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // It is created again so that afterEach has something to close.
    expect(await probeStatus(`http://127.0.0.1:${port}/401`)).toBeNull();
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });
});
