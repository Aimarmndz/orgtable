import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createReconnectRefresher,
  keepEventSourceOpen,
  retryDelay,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
} from "@/app/lib/realtime/reconnect";

// Regresión: tras un corte del EventSource, los cambios hechos mientras tanto no
// llegaban nunca porque el servidor no reenvía eventos. Ahora cada reapertura refresca.
describe("createReconnectRefresher", () => {
  it("no refresca en la primera apertura", () => {
    const onReconnect = vi.fn();
    const onOpen = createReconnectRefresher(onReconnect);
    onOpen();
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("refresca en cada reapertura posterior", () => {
    const onReconnect = vi.fn();
    const onOpen = createReconnectRefresher(onReconnect);
    onOpen();
    onOpen();
    onOpen();
    expect(onReconnect).toHaveBeenCalledTimes(2);
  });

  it("cada EventSource lleva su propio estado", () => {
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

// Doble de EventSource: registra los manejadores y deja simular open/error/CLOSED.
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
  // El navegador se rinde (respuesta no 200, p. ej. 502 del proxy): CLOSED + error.
  fail() {
    this.readyState = 2;
    this.emit("error");
  }
  // Corte transitorio: el navegador reintentará solo (CONNECTING + error).
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

function setup() {
  const sources: FakeSource[] = [];
  const onEvent = vi.fn();
  const onReconnect = vi.fn();
  const onClosed = vi.fn();
  const stop = keepEventSourceOpen({
    create: () => {
      const s = new FakeSource();
      sources.push(s);
      return s;
    },
    events: { change: onEvent },
    onReconnect,
    onClosed,
  });
  return { sources, onEvent, onReconnect, onClosed, stop };
}

describe("retryDelay", () => {
  it("dobla desde 3 s hasta un máximo de 30 s", () => {
    expect([0, 1, 2, 3, 4, 10].map(retryDelay)).toEqual([
      3_000, 6_000, 12_000, 24_000, 30_000, 30_000,
    ]);
  });
});

// Regresión: con un 502 del proxy durante un reinicio el EventSource quedaba CLOSED y
// nadie creaba otro; el tiempo real se perdía hasta recargar la pestaña.
describe("keepEventSourceOpen", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reenvía los eventos SSE al manejador", () => {
    const { sources, onEvent, stop } = setup();
    sources[0].open();
    sources[0].emit("change");
    expect(onEvent).toHaveBeenCalledTimes(1);
    stop();
  });

  it("recrea la fuente tras CLOSED con backoff y refresca al reabrir", () => {
    const { sources, onReconnect, onClosed, stop } = setup();
    sources[0].open();
    expect(onReconnect).not.toHaveBeenCalled();

    sources[0].fail();
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(sources[0].closed).toBe(true);
    expect(sources[0].listenerCount()).toBe(0);
    vi.advanceTimersByTime(RETRY_BASE_MS - 1);
    expect(sources).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sources).toHaveLength(2);

    // El servidor sigue caído: el siguiente intento espera el doble.
    sources[1].fail();
    vi.advanceTimersByTime(2 * RETRY_BASE_MS - 1);
    expect(sources).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sources).toHaveLength(3);

    // Vuelve: la primera apertura de la fuente recreada sí es una reconexión.
    sources[2].open();
    expect(onReconnect).toHaveBeenCalledTimes(1);

    // Tras abrir, el backoff vuelve a empezar en 3 s.
    sources[2].fail();
    vi.advanceTimersByTime(RETRY_BASE_MS);
    expect(sources).toHaveLength(4);
    stop();
  });

  it("no recrea la fuente en un corte que el navegador reintenta solo", () => {
    const { sources, onClosed, onReconnect, stop } = setup();
    sources[0].open();
    sources[0].drop();
    vi.advanceTimersByTime(RETRY_MAX_MS);
    expect(onClosed).not.toHaveBeenCalled();
    expect(sources).toHaveLength(1);
    sources[0].open();
    expect(onReconnect).toHaveBeenCalledTimes(1);
    stop();
  });

  it("la limpieza cierra la fuente y cancela el reintento pendiente", () => {
    const { sources, stop } = setup();
    sources[0].fail();
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
