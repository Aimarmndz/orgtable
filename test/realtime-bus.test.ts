import { EventEmitter } from "node:events";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Tests of the LISTEN/NOTIFY bridge of the realtime bus (app/lib/realtime/bus.ts). `pg`
// is replaced with a fake client: what is checked is the connection life cycle (closing
// on failure, reconnecting with backoff) and payload validation, not Postgres itself.

type Behavior = { listenFails: boolean; connectDelayMs: number };

const pgState = vi.hoisted(() => ({
  instances: [] as Array<{
    connect: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    emit: (event: string, ...args: unknown[]) => boolean;
  }>,
  behavior: { listenFails: false, connectDelayMs: 0 } as {
    listenFails: boolean;
    connectDelayMs: number;
  },
}));

vi.mock("pg", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  class Client extends Emitter {
    // Without a delay it resolves at once: that way the fake timers only count the bus's
    // own (retries), not the simulated client's.
    connect = vi.fn(() =>
      pgState.behavior.connectDelayMs > 0
        ? new Promise<void>((resolve) =>
            setTimeout(resolve, pgState.behavior.connectDelayMs),
          )
        : Promise.resolve(),
    );
    query = vi.fn(async (sql: string) => {
      if (sql.startsWith("LISTEN") && pgState.behavior.listenFails) {
        throw new Error("LISTEN rejected");
      }
      return { rows: [] };
    });
    end = vi.fn(async () => {
      this.emit("end");
    });
    constructor() {
      super();
      pgState.instances.push(this);
    }
  }
  return { Client };
});

type BusModule = typeof import("@/app/lib/realtime/bus");

const g = globalThis as Record<string, unknown>;
const GLOBAL_KEYS = [
  "__orgtableBus",
  "__orgtableInstanceId",
  "__orgtablePgClient",
  "__orgtablePgBridgePromise",
  "__orgtablePgReconnectTimer",
  "__orgtablePgReconnectAttempt",
];

function resetGlobals(): void {
  const timer = g.__orgtablePgReconnectTimer;
  if (timer) clearTimeout(timer as ReturnType<typeof setTimeout>);
  for (const key of GLOBAL_KEYS) delete g[key];
}

async function loadBus(behavior: Partial<Behavior> = {}): Promise<BusModule> {
  pgState.behavior = { listenFails: false, connectDelayMs: 0, ...behavior };
  vi.stubEnv("ORGTABLE_REALTIME_PG_NOTIFY", "1");
  vi.resetModules();
  return import("@/app/lib/realtime/bus");
}

function busEmitter(): EventEmitter {
  return g.__orgtableBus as EventEmitter;
}

beforeEach(() => {
  resetGlobals();
  pgState.instances.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  resetGlobals();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("parseBridgePayload", () => {
  it("accepts a valid payload", async () => {
    const { parseBridgePayload } = await loadBus();
    expect(
      parseBridgePayload(JSON.stringify({ kind: "board", id: "b1", origin: "x" })),
    ).toEqual({ kind: "board", id: "b1", origin: "x" });
  });

  it("returns null if the payload is not valid", async () => {
    const { parseBridgePayload } = await loadBus();
    expect(parseBridgePayload(JSON.stringify({ kind: "board", origin: "x" }))).toBeNull();
    expect(
      parseBridgePayload(JSON.stringify({ kind: "other", id: "b1", origin: "x" })),
    ).toBeNull();
    expect(parseBridgePayload("null")).toBeNull();
    expect(parseBridgePayload("[]")).toBeNull();
    expect(parseBridgePayload("not json")).toBeNull();
  });
});

describe("LISTEN/NOTIFY bridge", () => {
  it("closes the connection and logs it if LISTEN fails, and retries with backoff", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const bus = await loadBus({ listenFails: true });

    const unsubscribe = bus.subscribeBoard("b1", () => {});
    await vi.advanceTimersByTimeAsync(0);

    expect(pgState.instances).toHaveLength(1);
    expect(pgState.instances[0].end).toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(
      "[realtime] could not start the LISTEN/NOTIFY bridge",
      expect.any(Error),
    );

    // Another subscription during the backoff does not open another connection.
    const unsubscribe2 = bus.subscribeBoard("b2", () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(pgState.instances).toHaveLength(1);

    // First retry after 1 s, second after 2 s: each failed client is closed.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pgState.instances).toHaveLength(2);
    expect(pgState.instances[1].end).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(pgState.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(pgState.instances).toHaveLength(3);

    // Without subscribers no retry is scheduled any more.
    unsubscribe();
    unsubscribe2();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pgState.instances).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("after a connection error it closes it and reconnects", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const bus = await loadBus();

    bus.subscribeBoard("b1", () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(pgState.instances).toHaveLength(1);
    expect(pgState.instances[0].end).not.toHaveBeenCalled();

    pgState.instances[0].emit("error", new Error("connection lost"));
    expect(pgState.instances[0].end).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith(
      "[realtime] error on the LISTEN/NOTIFY bridge connection",
      expect.any(Error),
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(pgState.instances).toHaveLength(2);
    expect(pgState.instances[1].end).not.toHaveBeenCalled();
  });

  it("publishing during start-up waits for the bridge instead of losing the event", async () => {
    const bus = await loadBus({ connectDelayMs: 500 });

    bus.subscribeBoard("b1", () => {});
    const published = bus.publishBoardEvent("b1");
    await vi.advanceTimersByTimeAsync(500);
    await published;

    expect(pgState.instances).toHaveLength(1);
    const notifyCall = pgState.instances[0].query.mock.calls.find(
      ([sql]) => sql === "SELECT pg_notify($1, $2)",
    );
    expect(notifyCall).toBeDefined();
  });

  it("re-emits valid NOTIFYs from other instances and discards invalid ones", async () => {
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bus = await loadBus();
    const received: string[] = [];
    // A payload without an id used to be re-emitted on "board:undefined".
    const stray = vi.fn();
    busEmitter().on("board:undefined", stray);

    bus.subscribeBoard("b1", (event) => received.push(event.boardId));
    await vi.advanceTimersByTimeAsync(0);
    const client = pgState.instances[0];

    client.emit("notification", {
      payload: JSON.stringify({ kind: "board", id: "b1", origin: "other" }),
    });
    expect(received).toEqual(["b1"]);

    client.emit("notification", {
      payload: JSON.stringify({ kind: "board", origin: "other" }),
    });
    client.emit("notification", { payload: "{broken" });
    expect(received).toEqual(["b1"]);
    expect(warns).toHaveBeenCalledTimes(2);
    expect(stray).not.toHaveBeenCalled();
  });
});
