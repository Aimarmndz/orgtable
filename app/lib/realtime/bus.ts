import "server-only";
import { EventEmitter } from "node:events";
import { Client } from "pg";
import { z } from "zod";

// Bus de publicación/suscripción para la sincronización en vivo (Hito 4).
//
// Por defecto es EN PROCESO (un EventEmitter): suficiente para el despliegue estándar
// de orgtable (un único contenedor de app, ver docker-compose.yml). Las Server Actions
// publican un evento por tablero tras mutar; las conexiones SSE (app/api/boards/[id]/
// stream) se suscriben y reenvían "refresca" al navegador.
//
// Para despliegues MULTI-INSTANCIA hay un puente opcional sobre PostgreSQL
// LISTEN/NOTIFY (no Redis: ya dependemos de Postgres; ver ADR 0007). Se activa con
// ORGTABLE_REALTIME_PG_NOTIFY=1. Cada instancia escucha el canal y reemite localmente
// los eventos de OTRAS instancias (ignora los propios, ya emitidos en el acto).

const CHANNEL = "orgtable_realtime";
const PG_NOTIFY_ENABLED = process.env.ORGTABLE_REALTIME_PG_NOTIFY === "1";

// Singletons sobre globalThis: en desarrollo Next recarga módulos en caliente (HMR) y
// crearía emisores/clientes duplicados. En producción se crean una sola vez.
const g = globalThis as unknown as {
  __orgtableBus?: EventEmitter;
  __orgtableInstanceId?: string;
  // Cliente LISTEN activo (solo cuando el LISTEN ya se ha confirmado).
  __orgtablePgClient?: Client;
  // Arranque en curso: publishCrossInstance lo espera en vez de perder el evento.
  __orgtablePgBridgePromise?: Promise<void>;
  // Único temporizador de reconexión y número de intentos fallidos seguidos (backoff).
  __orgtablePgReconnectTimer?: ReturnType<typeof setTimeout>;
  __orgtablePgReconnectAttempt?: number;
};

const emitter = g.__orgtableBus ?? new EventEmitter();
// Sin límite de listeners: puede haber muchas conexiones SSE simultáneas.
emitter.setMaxListeners(0);
g.__orgtableBus = emitter;

const INSTANCE_ID =
  g.__orgtableInstanceId ?? Math.random().toString(36).slice(2);
g.__orgtableInstanceId = INSTANCE_ID;

export type BoardEvent = { type: "board:changed"; boardId: string; at: number };
// Evento por usuario (Hito 8): un "ping" para que la pestaña recargue sus
// notificaciones. No lleva el contenido, solo avisa de que hay algo nuevo.
export type UserEvent = { type: "notification:new"; userId: string; at: number };

const channelFor = (boardId: string) => `board:${boardId}`;
const channelForUser = (userId: string) => `user:${userId}`;

function emitLocal(boardId: string): void {
  const event: BoardEvent = {
    type: "board:changed",
    boardId,
    at: Date.now(),
  };
  emitter.emit(channelFor(boardId), event);
}

function emitLocalUser(userId: string): void {
  const event: UserEvent = {
    type: "notification:new",
    userId,
    at: Date.now(),
  };
  emitter.emit(channelForUser(userId), event);
}

/** Suscribe a los cambios de un tablero. Devuelve la función para cancelar. */
export function subscribeBoard(
  boardId: string,
  handler: (event: BoardEvent) => void,
): () => void {
  emitter.on(channelFor(boardId), handler);
  void ensurePgBridge();
  return () => emitter.off(channelFor(boardId), handler);
}

/** Suscribe a los eventos de un usuario (notificaciones). Devuelve cómo cancelar. */
export function subscribeUser(
  userId: string,
  handler: (event: UserEvent) => void,
): () => void {
  emitter.on(channelForUser(userId), handler);
  void ensurePgBridge();
  return () => emitter.off(channelForUser(userId), handler);
}

/** Publica que un tablero cambió. Lo llaman las Server Actions tras cada mutación. */
export async function publishBoardEvent(boardId: string): Promise<void> {
  emitLocal(boardId);
  if (PG_NOTIFY_ENABLED) {
    await publishCrossInstance({ kind: "board", id: boardId }).catch(
      (err: unknown) => {
        // Un fallo del puente nunca debe romper la mutación: el modo en proceso sigue.
        console.error("[realtime] no se pudo publicar en el puente LISTEN/NOTIFY", {
          kind: "board",
          id: boardId,
        }, err);
      },
    );
  }
}

/** Publica que un usuario tiene una notificación nueva (entrega en vivo). */
export async function publishUserEvent(userId: string): Promise<void> {
  emitLocalUser(userId);
  if (PG_NOTIFY_ENABLED) {
    await publishCrossInstance({ kind: "user", id: userId }).catch(
      (err: unknown) => {
        // Best-effort: el modo en proceso ya emitió localmente.
        console.error("[realtime] no se pudo publicar en el puente LISTEN/NOTIFY", {
          kind: "user",
          id: userId,
        }, err);
      },
    );
  }
}

// --- Puente opcional PostgreSQL LISTEN/NOTIFY (multi-instancia) ---

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

// Cualquiera con acceso a la BD puede hacer NOTIFY en el canal: el payload se valida en
// vez de fiarse de un cast (un payload sin id emitiría en "board:undefined").
const bridgePayloadSchema = z.object({
  kind: z.enum(["board", "user"]),
  id: z.string().min(1),
  origin: z.string().min(1),
});
export type BridgePayload = z.infer<typeof bridgePayloadSchema>;

/** Parsea y valida el payload de un NOTIFY. Devuelve null si no es válido. */
export function parseBridgePayload(raw: string): BridgePayload | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    // No es JSON: se trata igual que una estructura inválida.
    return null;
  }
  const parsed = bridgePayloadSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

function handleBridgeNotification(raw: string | undefined): void {
  if (!raw) return;
  const data = parseBridgePayload(raw);
  if (!data) {
    // Sin volcar el payload: puede venir de cualquiera con acceso a la BD.
    console.warn(
      `[realtime] NOTIFY descartado: no es JSON o no tiene { kind, id, origin } válidos (${raw.length} caracteres)`,
    );
    return;
  }
  // Ignora los eventos originados en esta instancia: ya se emitieron localmente.
  if (data.origin === INSTANCE_ID) return;
  if (data.kind === "user") emitLocalUser(data.id);
  else emitLocal(data.id);
}

function closeClient(client: Client): void {
  client.end().catch((err: unknown) => {
    console.error("[realtime] no se pudo cerrar la conexión del puente LISTEN/NOTIFY", err);
  });
}

// La conexión del puente cayó: se cierra (si no, cada reintento abriría otra conexión
// hasta agotar las de Postgres) y se programa la reconexión. Solo actúa si `client` es
// el activo, para que un "error" seguido de "end" no lo haga dos veces.
function dropPgClient(client: Client): void {
  if (g.__orgtablePgClient !== client) return;
  g.__orgtablePgClient = undefined;
  closeClient(client);
  scheduleReconnect();
}

// Reconexión con backoff exponencial (1 s → 30 s) y un único temporizador. Si ya no
// queda ningún suscriptor no se programa: la próxima suscripción arranca el puente.
function scheduleReconnect(): void {
  if (g.__orgtablePgReconnectTimer) return;
  if (emitter.eventNames().length === 0) return;
  const attempt = g.__orgtablePgReconnectAttempt ?? 0;
  const delay = Math.min(RECONNECT_MIN_MS * 2 ** attempt, RECONNECT_MAX_MS);
  g.__orgtablePgReconnectAttempt = attempt + 1;
  const timer = setTimeout(() => {
    g.__orgtablePgReconnectTimer = undefined;
    // Todos se desuscribieron durante la espera: no hace falta conexión.
    if (emitter.eventNames().length === 0) return;
    void ensurePgBridge();
  }, delay);
  // No mantiene vivo el proceso solo por este reintento.
  timer.unref?.();
  g.__orgtablePgReconnectTimer = timer;
}

async function startPgBridge(): Promise<void> {
  let client: Client | undefined;
  try {
    const current = new Client({ connectionString: process.env.DATABASE_URL });
    client = current;
    current.on("notification", (msg) => handleBridgeNotification(msg.payload));
    current.on("error", (err) => {
      console.error("[realtime] error en la conexión del puente LISTEN/NOTIFY", err);
      dropPgClient(current);
    });
    current.on("end", () => {
      if (g.__orgtablePgClient === current) {
        console.error("[realtime] la conexión del puente LISTEN/NOTIFY se cerró");
      }
      dropPgClient(current);
    });
    await current.connect();
    await current.query(`LISTEN ${CHANNEL}`);
    g.__orgtablePgClient = current;
    g.__orgtablePgReconnectAttempt = 0;
  } catch (err) {
    // El error de pg no incluye la contraseña; DATABASE_URL no se registra nunca.
    console.error("[realtime] no se pudo iniciar el puente LISTEN/NOTIFY", err);
    if (client) closeClient(client);
    scheduleReconnect();
  }
}

function ensurePgBridge(): Promise<void> {
  if (!PG_NOTIFY_ENABLED) return Promise.resolve();
  if (g.__orgtablePgClient) return Promise.resolve();
  // Con una reconexión programada se respeta el backoff: no se abre otra conexión.
  if (g.__orgtablePgReconnectTimer) return Promise.resolve();
  if (!g.__orgtablePgBridgePromise) {
    g.__orgtablePgBridgePromise = startPgBridge().finally(() => {
      g.__orgtablePgBridgePromise = undefined;
    });
  }
  return g.__orgtablePgBridgePromise;
}

async function publishCrossInstance(target: {
  kind: "board" | "user";
  id: string;
}): Promise<void> {
  // Espera un arranque en curso: antes, mientras el estado era "starting", el evento
  // se descartaba sin publicarse.
  await ensurePgBridge();
  const client = g.__orgtablePgClient;
  if (!client) return;
  const payload = JSON.stringify({ ...target, origin: INSTANCE_ID });
  await client.query("SELECT pg_notify($1, $2)", [CHANNEL, payload]);
}
