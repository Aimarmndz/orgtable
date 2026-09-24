import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createReconnectRefresher,
  keepEventSourceOpen,
  probeStatus,
  retryDelay,
  scheduleRefresh,
  REFRESH_DEBOUNCE_MS,
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

// `status`: lo que respondería el endpoint al comprobar por qué se cerró la fuente.
function setup(status: number | null = 502) {
  const sources: FakeSource[] = [];
  const onEvent = vi.fn();
  const onReconnect = vi.fn();
  const onAccessDenied = vi.fn();
  const probe = vi.fn(async () => status);
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

// Deja resolver la promesa de `probe` sin adelantar el reloj.
const flush = () => vi.advanceTimersByTimeAsync(0);

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

  it("recrea la fuente tras CLOSED con backoff y refresca al reabrir", async () => {
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

    // El servidor sigue caído: el siguiente intento espera el doble.
    sources[1].fail();
    await flush();
    vi.advanceTimersByTime(2 * RETRY_BASE_MS - 1);
    expect(sources).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sources).toHaveLength(3);

    // Vuelve: la primera apertura de la fuente recreada sí es una reconexión.
    sources[2].open();
    expect(onReconnect).toHaveBeenCalledTimes(1);

    // Tras abrir, el backoff vuelve a empezar en 3 s.
    sources[2].fail();
    await flush();
    vi.advanceTimersByTime(RETRY_BASE_MS);
    expect(sources).toHaveLength(4);
    expect(onAccessDenied).not.toHaveBeenCalled();
    stop();
  });

  // Regresión: con un 502 del proxy (o un 500 por un fallo pasajero de la BD) se hacía
  // router.refresh(); en Next 16 un refresh con respuesta no OK navega a la página de
  // error y la pestaña perdía la app. Ahora un 5xx o un error de red solo reintentan.
  it.each([500, 502, 503, null])(
    "ante %s no avisa de acceso denegado y reintenta",
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
    "ante %s avisa de acceso denegado (para redirigir) y reintenta",
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

  it("si la comprobación falla, reintenta sin avisar de acceso denegado", async () => {
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
      probe: () => Promise.reject(new Error("fallo inesperado")),
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

  it("no reintenta ni avisa si se desmonta mientras se comprueba el estado", async () => {
    const { sources, onAccessDenied, stop } = setup(401);
    sources[0].fail();
    stop();
    await flush();
    vi.advanceTimersByTime(RETRY_MAX_MS);
    expect(onAccessDenied).not.toHaveBeenCalled();
    expect(sources).toHaveLength(1);
  });

  it("no recrea la fuente en un corte que el navegador reintenta solo", async () => {
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

  it("la limpieza cierra la fuente y cancela el reintento pendiente", async () => {
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

// Regresión: en /board/[id] la campana y el tablero reconectan a la vez y cada uno
// lanzaba su router.refresh(); dos renders completos del tablero en vez de uno.
describe("scheduleRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("agrupa en un solo refresh las peticiones de varios componentes", () => {
    const refreshBoard = vi.fn();
    const refreshBell = vi.fn();
    scheduleRefresh(refreshBoard);
    scheduleRefresh(refreshBell);
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    expect(refreshBoard.mock.calls.length + refreshBell.mock.calls.length).toBe(1);
  });

  it("vuelve a refrescar si la petición llega fuera de la ventana", () => {
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

// Con un servidor HTTP real: el estado tiene que llegar sin esperar al cuerpo (un
// stream SSE no termina nunca) y la conexión debe cerrarse al momento.
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
      // Stream SSE que no se cierra por su cuenta.
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

  it("devuelve el estado de error del endpoint", async () => {
    expect(await probeStatus(`${base}/401`)).toBe(401);
    expect(await probeStatus(`${base}/502`)).toBe(502);
  });

  it("con un stream abierto devuelve 200 y corta la conexión", async () => {
    expect(await probeStatus(`${base}/stream`)).toBe(200);
    await streamClosed;
  });

  it("sin respuesta (servidor caído) devuelve null", async () => {
    const port = (server.address() as AddressInfo).port;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // Se vuelve a crear para que afterEach tenga algo que cerrar.
    expect(await probeStatus(`http://127.0.0.1:${port}/401`)).toBeNull();
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });
});
