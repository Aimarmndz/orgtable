import "server-only";
import { EventEmitter } from "node:events";
import { Client } from "pg";

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
  __orgtablePgBridge?: "starting" | "ready" | "off";
  __orgtablePgClient?: Client;
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
    await publishCrossInstance({ kind: "board", id: boardId }).catch(() => {
      // Un fallo del puente nunca debe romper la mutación: el modo en proceso sigue.
    });
  }
}

/** Publica que un usuario tiene una notificación nueva (entrega en vivo). */
export async function publishUserEvent(userId: string): Promise<void> {
  emitLocalUser(userId);
  if (PG_NOTIFY_ENABLED) {
    await publishCrossInstance({ kind: "user", id: userId }).catch(() => {
      // Best-effort: el modo en proceso ya emitió localmente.
    });
  }
}

// --- Puente opcional PostgreSQL LISTEN/NOTIFY (multi-instancia) ---

async function ensurePgBridge(): Promise<void> {
  if (!PG_NOTIFY_ENABLED) return;
  if (g.__orgtablePgBridge === "ready" || g.__orgtablePgBridge === "starting") {
    return;
  }
  g.__orgtablePgBridge = "starting";
  try {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    client.on("notification", (msg) => {
      if (!msg.payload) return;
      try {
        const data = JSON.parse(msg.payload) as {
          kind: "board" | "user";
          id: string;
          origin: string;
        };
        // Ignora los eventos originados en esta instancia: ya se emitieron localmente.
        if (data.origin === INSTANCE_ID) return;
        if (data.kind === "user") emitLocalUser(data.id);
        else emitLocal(data.id);
      } catch {
        // Payload no válido: se ignora.
      }
    });
    client.on("error", () => {
      // La conexión del puente cayó; el modo en proceso sigue funcionando. Se
      // reintentará en la próxima suscripción.
      g.__orgtablePgBridge = "off";
      g.__orgtablePgClient = undefined;
    });
    await client.query(`LISTEN ${CHANNEL}`);
    g.__orgtablePgClient = client;
    g.__orgtablePgBridge = "ready";
  } catch {
    g.__orgtablePgBridge = "off";
  }
}

async function publishCrossInstance(target: {
  kind: "board" | "user";
  id: string;
}): Promise<void> {
  await ensurePgBridge();
  const client = g.__orgtablePgClient;
  if (!client) return;
  const payload = JSON.stringify({ ...target, origin: INSTANCE_ID });
  await client.query("SELECT pg_notify($1, $2)", [CHANNEL, payload]);
}
