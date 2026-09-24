import { EventEmitter } from "node:events";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Tests del puente LISTEN/NOTIFY del bus de tiempo real (app/lib/realtime/bus.ts). Se
// sustituye `pg` por un cliente falso: lo que se comprueba es el ciclo de vida de la
// conexión (cierre al fallar, reconexión con backoff) y la validación del payload, no
// Postgres en sí.

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
    // Sin retardo resuelve en el acto: así los temporizadores falsos solo cuentan los
    // del bus (reintentos), no los del cliente simulado.
    connect = vi.fn(() =>
      pgState.behavior.connectDelayMs > 0
        ? new Promise<void>((resolve) =>
            setTimeout(resolve, pgState.behavior.connectDelayMs),
          )
        : Promise.resolve(),
    );
    query = vi.fn(async (sql: string) => {
      if (sql.startsWith("LISTEN") && pgState.behavior.listenFails) {
        throw new Error("LISTEN rechazado");
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
  it("acepta un payload válido", async () => {
    const { parseBridgePayload } = await loadBus();
    expect(
      parseBridgePayload(JSON.stringify({ kind: "board", id: "b1", origin: "x" })),
    ).toEqual({ kind: "board", id: "b1", origin: "x" });
  });

  it("devuelve null si el payload no es válido", async () => {
    const { parseBridgePayload } = await loadBus();
    expect(parseBridgePayload(JSON.stringify({ kind: "board", origin: "x" }))).toBeNull();
    expect(
      parseBridgePayload(JSON.stringify({ kind: "otro", id: "b1", origin: "x" })),
    ).toBeNull();
    expect(parseBridgePayload("null")).toBeNull();
    expect(parseBridgePayload("[]")).toBeNull();
    expect(parseBridgePayload("no es json")).toBeNull();
  });
});

describe("puente LISTEN/NOTIFY", () => {
  it("cierra la conexión y lo registra si LISTEN falla, y reintenta con backoff", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const bus = await loadBus({ listenFails: true });

    const unsubscribe = bus.subscribeBoard("b1", () => {});
    await vi.advanceTimersByTimeAsync(0);

    expect(pgState.instances).toHaveLength(1);
    expect(pgState.instances[0].end).toHaveBeenCalled();
    expect(errors).toHaveBeenCalledWith(
      "[realtime] no se pudo iniciar el puente LISTEN/NOTIFY",
      expect.any(Error),
    );

    // Otra suscripción durante el backoff no abre otra conexión.
    const unsubscribe2 = bus.subscribeBoard("b2", () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(pgState.instances).toHaveLength(1);

    // Primer reintento a 1 s, segundo a 2 s: cada cliente fallido se cierra.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pgState.instances).toHaveLength(2);
    expect(pgState.instances[1].end).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(pgState.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(pgState.instances).toHaveLength(3);

    // Sin suscriptores ya no se programa ningún reintento.
    unsubscribe();
    unsubscribe2();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pgState.instances).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("tras un error de la conexión la cierra y reconecta", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const bus = await loadBus();

    bus.subscribeBoard("b1", () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(pgState.instances).toHaveLength(1);
    expect(pgState.instances[0].end).not.toHaveBeenCalled();

    pgState.instances[0].emit("error", new Error("conexión perdida"));
    expect(pgState.instances[0].end).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith(
      "[realtime] error en la conexión del puente LISTEN/NOTIFY",
      expect.any(Error),
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(pgState.instances).toHaveLength(2);
    expect(pgState.instances[1].end).not.toHaveBeenCalled();
  });

  it("publicar durante el arranque espera al puente en vez de perder el evento", async () => {
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

  it("reemite los NOTIFY válidos de otras instancias y descarta los inválidos", async () => {
    const warns = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bus = await loadBus();
    const received: string[] = [];
    // Antes, un payload sin id se reemitía en "board:undefined".
    const stray = vi.fn();
    busEmitter().on("board:undefined", stray);

    bus.subscribeBoard("b1", (event) => received.push(event.boardId));
    await vi.advanceTimersByTimeAsync(0);
    const client = pgState.instances[0];

    client.emit("notification", {
      payload: JSON.stringify({ kind: "board", id: "b1", origin: "otra" }),
    });
    expect(received).toEqual(["b1"]);

    client.emit("notification", {
      payload: JSON.stringify({ kind: "board", origin: "otra" }),
    });
    client.emit("notification", { payload: "{roto" });
    expect(received).toEqual(["b1"]);
    expect(warns).toHaveBeenCalledTimes(2);
    expect(stray).not.toHaveBeenCalled();
  });
});
