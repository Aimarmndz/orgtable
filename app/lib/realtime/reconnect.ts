// Resincronización al reconectar un EventSource (tablero y campana de notificaciones).
//
// El servidor no reenvía los eventos perdidos (no hay Last-Event-ID ni historial): lo
// que cambió mientras la conexión estaba caída (suspensión del portátil, reinicio del
// servidor, corte de red) no llega nunca. Por eso, cada vez que el EventSource vuelve a
// abrirse DESPUÉS de la primera vez, se pide un refresh para traer el estado actual.
// En la primera apertura no hace falta: la página acaba de renderizarse con datos frescos.

// Un solo refresco por pestaña. router.refresh() vuelve a renderizar todo el árbol de
// la ruta, layout incluido: en /board/[id] la campana (layout) y BoardRealtime (página)
// tienen cada uno su EventSource, que el servidor corta a la vez (vida máxima de 15 min,
// reinicio, suspensión del portátil). Con un debounce por componente cada reconexión
// costaba dos renders completos del tablero; con este temporizador de módulo las
// peticiones de ambos dentro de la ventana se agrupan en uno.
export const REFRESH_DEBOUNCE_MS = 200;
let pendingRefresh: ReturnType<typeof setTimeout> | null = null;

/**
 * Programa un refresh agrupado con los que pida cualquier componente en los próximos
 * REFRESH_DEBOUNCE_MS. No se cancela al desmontar: el temporizador es compartido y
 * cancelarlo anularía el refresh que pidió el otro componente; un router.refresh()
 * tras desmontar solo refresca la ruta actual, sin efectos dañinos.
 */
export function scheduleRefresh(refresh: () => void): void {
  if (pendingRefresh) clearTimeout(pendingRefresh);
  pendingRefresh = setTimeout(() => {
    pendingRefresh = null;
    refresh();
  }, REFRESH_DEBOUNCE_MS);
}

/** Devuelve el manejador de "open": ignora la primera apertura y avisa en las siguientes. */
export function createReconnectRefresher(onReconnect: () => void): () => void {
  let opened = false;
  return () => {
    if (opened) onReconnect();
    opened = true;
  };
}

// Reintento cuando el navegador se rinde. EventSource reconecta por su cuenta si la
// respuesta fue 200 o la conexión se cortó; ante cualquier otro estado (p. ej. el 502
// de un proxy TLS mientras scripts/update.sh reinicia la app, o un 401/403) queda en
// CLOSED para siempre y el tiempo real se perdía sin aviso hasta recargar la pestaña.
// Por eso se crea un EventSource nuevo con backoff exponencial de 3 s a 30 s.
//
// EventSource no expone el estado HTTP, así que al quedar CLOSED se pregunta al mismo
// endpoint (probeStatus) y solo se avisa de acceso denegado ante 401/403. No se puede
// hacer router.refresh() a ciegas: en Next 16, si la petición RSC del refresh recibe
// una respuesta no OK o falla por red, el router hace una navegación completa (ver
// fetch-server-response.js, doMpaNavigation) y la pestaña acababa en la página
// «502 Bad Gateway» del proxy, perdiendo lo que no se hubiera guardado.
export const RETRY_BASE_MS = 3_000;
export const RETRY_MAX_MS = 30_000;

// Plazo máximo de la comprobación. fetch no tiene timeout en el navegador: si el proxy
// retiene la conexión mientras la app arranca, o verifySession espera una conexión del
// pool durante el mismo fallo de BD que dio el 500, la comprobación no respondería
// nunca y, como el reintento se programa al terminarla, no se recrearía la fuente.
export const PROBE_TIMEOUT_MS = 10_000;

// Valor de EventSource.CLOSED. Se usa el literal porque en Node (tests) no existe el
// global EventSource.
const CLOSED = 2;

/** Espera antes del reintento número `attempt` (0, 1, 2…): 3 s, 6 s, 12 s, 24 s, 30 s… */
export function retryDelay(attempt: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
}

/** Lo que el helper usa de un EventSource (permite probarlo sin navegador). */
export type EventSourceLike = {
  readonly readyState: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  close(): void;
};

/**
 * Estado HTTP del endpoint SSE, o null si no hubo respuesta (error de red, servidor
 * caído, o `signal` abortada por el plazo o el desmontaje). Es un GET normal que se
 * aborta en cuanto llegan las cabeceras: con un 200 el stream se abre y se cierra al
 * momento (el servidor limpia la suscripción por el abort). No se usa HEAD porque en
 * App Router se deriva del GET y abriría igualmente el stream.
 */
export async function probeStatus(url: string, signal?: AbortSignal): Promise<number | null> {
  const controller = new AbortController();
  // Se encadena a mano en vez de con AbortSignal.any, que Safari solo tiene desde 17.4.
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
    // Sin respuesta no hay estado que interpretar: el llamador reintenta con backoff.
    // Solo se toleran el fallo de red (TypeError de fetch) y el abort pedido desde
    // fuera; cualquier otro error es un bug.
    if (err instanceof TypeError || controller.signal.aborted) return null;
    throw err;
  } finally {
    signal?.removeEventListener("abort", forwardAbort);
    controller.abort();
  }
}

/**
 * Mantiene un EventSource abierto mientras el componente esté montado y devuelve la
 * función de limpieza para el efecto.
 * - `events`: manejadores por nombre de evento SSE.
 * - `onReconnect`: se llama en cada apertura salvo la primera (también en las fuentes
 *   recreadas), para traer lo perdido durante el corte.
 * - `probe`: cuando el navegador deja la fuente en CLOSED, averigua el estado HTTP del
 *   endpoint (probeStatus en la app; inyectable para probarlo sin navegador). Recibe
 *   una señal que se aborta al pasar PROBE_TIMEOUT_MS o al desmontar; aunque `probe` la
 *   ignore, pasado el plazo se reintenta como ante un error de red.
 * - `onAccessDenied`: solo si `probe` da 401/403 (sesión o acceso revocados); con un
 *   `router.refresh()` la página redirige y el desmontaje cancela el reintento. Ante un
 *   5xx o un error de red no se llama: solo se reintenta, y al reabrirse `onReconnect`
 *   ya resincroniza con el servidor sano.
 */
export function keepEventSourceOpen(options: {
  create: () => EventSourceLike;
  events: Record<string, () => void>;
  onReconnect: () => void;
  probe: (signal: AbortSignal) => Promise<number | null>;
  onAccessDenied: () => void;
}): () => void {
  const { create, events, onReconnect, probe, onAccessDenied } = options;
  // Una sola instancia para todas las fuentes: la primera apertura de una fuente
  // recreada sí es una reconexión.
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
    // El plazo compite con la comprobación en vez de fiarse de que `probe` respete la
    // señal: el reintento tiene que programarse pase lo que pase.
    const timedOut = new Promise<null>((resolve) => {
      probeTimer = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, PROBE_TIMEOUT_MS);
    });
    const checked = probe(controller.signal).catch((err: unknown) => {
      // Abortada por el plazo o el desmontaje: ya se sabe por qué, no es un fallo.
      if (controller.signal.aborted) return null;
      // Si no se sabe por qué se cerró, no se refresca (podría navegar a una página
      // de error): se reintenta igual que ante un 5xx.
      console.error("[realtime] no se pudo comprobar por qué se cerró el stream", err);
      return null;
    });
    void Promise.race([checked, timedOut]).then((status) => {
      if (probeTimer) clearTimeout(probeTimer);
      probeTimer = null;
      probeController = null;
      // El componente pudo desmontarse mientras se comprobaba.
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
    // Corta la comprobación en curso para no dejar la petición colgada tras desmontar.
    if (probeTimer) clearTimeout(probeTimer);
    probeTimer = null;
    probeController?.abort();
    probeController = null;
    if (source) detach(source);
    source = null;
  };
}
