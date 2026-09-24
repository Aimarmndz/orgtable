// Resincronización al reconectar un EventSource (tablero y campana de notificaciones).
//
// El servidor no reenvía los eventos perdidos (no hay Last-Event-ID ni historial): lo
// que cambió mientras la conexión estaba caída (suspensión del portátil, reinicio del
// servidor, corte de red) no llega nunca. Por eso, cada vez que el EventSource vuelve a
// abrirse DESPUÉS de la primera vez, se pide un refresh para traer el estado actual.
// En la primera apertura no hace falta: la página acaba de renderizarse con datos frescos.

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
export const RETRY_BASE_MS = 3_000;
export const RETRY_MAX_MS = 30_000;

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
 * Mantiene un EventSource abierto mientras el componente esté montado y devuelve la
 * función de limpieza para el efecto.
 * - `events`: manejadores por nombre de evento SSE.
 * - `onReconnect`: se llama en cada apertura salvo la primera (también en las fuentes
 *   recreadas), para traer lo perdido durante el corte.
 * - `onClosed`: se llama cuando el navegador deja la fuente en CLOSED; con un
 *   `router.refresh()` la página redirige si se revocó la sesión o el acceso (y el
 *   desmontaje cancela el reintento).
 */
export function keepEventSourceOpen(options: {
  create: () => EventSourceLike;
  events: Record<string, () => void>;
  onReconnect: () => void;
  onClosed: () => void;
}): () => void {
  const { create, events, onReconnect, onClosed } = options;
  // Una sola instancia para todas las fuentes: la primera apertura de una fuente
  // recreada sí es una reconexión.
  const refreshOnReopen = createReconnectRefresher(onReconnect);
  let source: EventSourceLike | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
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
    onClosed();
    retryTimer = setTimeout(connect, retryDelay(attempt));
    attempt += 1;
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
    if (source) detach(source);
    source = null;
  };
}
