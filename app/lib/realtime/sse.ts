import "server-only";
import { prisma } from "@/app/lib/prisma";

// Ciclo de vida común de los streams SSE (tablero y notificaciones). Vive aparte para
// que las dos rutas compartan la misma limpieza: antes cada una tenía su copia y ambas
// dejaban el intervalo y la suscripción colgados si `enqueue` fallaba. Ver docs/realtime.md.

/** Latido para proxies y, a la vez, momento en que se revalida el acceso. */
export const HEARTBEAT_MS = 25_000;
/**
 * Vida máxima de una conexión. Al cerrarla, EventSource reconecta y la ruta vuelve a
 * autorizar desde cero con la cookie (verifySession), no solo con la sesión guardada.
 */
export const MAX_STREAM_MS = 15 * 60_000;

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // Desactiva el buffering de nginx para que los eventos lleguen al instante.
  "X-Accel-Buffering": "no",
} as const;

/**
 * true si la sesión sigue activa (ni revocada ni caducada). Se consulta directamente la
 * tabla porque fuera de la petición inicial no hay cookies: verifySession no sirve aquí.
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
  /** Etiqueta para los logs (sin datos personales), p. ej. "tablero". */
  label: string;
  /** Se suscribe al bus y devuelve cómo cancelar la suscripción. */
  subscribe: (send: (chunk: string) => void) => () => void;
  /** Se llama en cada latido; si devuelve false, el stream se cierra. */
  isStillAuthorized: () => Promise<boolean>;
}): Response {
  const { signal, label, subscribe, isStillAuthorized } = opts;

  // El cliente pudo irse mientras se autorizaba (los await previos): si el abort ya
  // ocurrió, el listener de "abort" nunca se dispararía y la suscripción quedaría viva.
  if (signal.aborted) return new Response(null, { status: 204 });

  const encoder = new TextEncoder();
  const openedAt = Date.now();
  let cleaned = false;
  let checking = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;

  // Idempotente: la llaman el abort, cancel(), un enqueue fallido, la revalidación y la
  // vida máxima; cualquiera puede llegar primero.
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe?.();
    signal.removeEventListener("abort", cleanup);
    try {
      controllerRef?.close();
    } catch (err) {
      // Tras cancel() o un error del stream, close() lanza: ya no hay nada que cerrar.
      if (!(err instanceof TypeError)) {
        console.error(`[realtime] error al cerrar el stream SSE de ${label}`, err);
      }
    }
  };

  const send = (chunk: string) => {
    if (cleaned || !controllerRef) return;
    try {
      controllerRef.enqueue(encoder.encode(chunk));
    } catch {
      // El consumidor ya no lee (stream cerrado o cancelado): se libera todo.
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
        // Sin poder comprobar el acceso no se sigue emitiendo: el cliente reconecta y
        // la ruta vuelve a autorizar.
        console.error(`[realtime] no se pudo revalidar el acceso al stream de ${label}`, err);
        cleanup();
      })
      .finally(() => {
        checking = false;
      });
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      // Comentario inicial: abre el stream y fija el intervalo de reconexión del cliente.
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
