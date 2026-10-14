import "server-only";
import { EventEmitter } from "node:events";
import { Client } from "pg";
import { z } from "zod";

// Publish/subscribe bus for live sync.
//
// By default it is IN-PROCESS (an EventEmitter): enough for orgtable's standard deployment
// (a single app container, see docker-compose.yml). Server Actions publish one event per
// board after mutating; SSE connections (app/api/boards/[id]/stream) subscribe and forward
// "refresh" to the browser.
//
// For MULTI-INSTANCE deployments there is an optional bridge over PostgreSQL LISTEN/NOTIFY
// (not Redis: Postgres is already a dependency; see ADR 0007). Enabled with
// ORGTABLE_REALTIME_PG_NOTIFY=1. Each instance listens on the channel and re-emits locally
// the events of OTHER instances (its own were already emitted on the spot).

const CHANNEL = "orgtable_realtime";
const PG_NOTIFY_ENABLED = process.env.ORGTABLE_REALTIME_PG_NOTIFY === "1";

// Singletons on globalThis: in development Next hot-reloads modules (HMR) and would create
// duplicate emitters/clients. In production they are created only once.
const g = globalThis as unknown as {
  __orgtableBus?: EventEmitter;
  __orgtableInstanceId?: string;
  // Active LISTEN client (only once the LISTEN has been confirmed).
  __orgtablePgClient?: Client;
  // Start-up in progress: publishCrossInstance waits for it instead of losing the event.
  __orgtablePgBridgePromise?: Promise<void>;
  // Single reconnect timer and number of consecutive failed attempts (backoff).
  __orgtablePgReconnectTimer?: ReturnType<typeof setTimeout>;
  __orgtablePgReconnectAttempt?: number;
};

const emitter = g.__orgtableBus ?? new EventEmitter();
// No listener limit: there can be many simultaneous SSE connections.
emitter.setMaxListeners(0);
g.__orgtableBus = emitter;

const INSTANCE_ID =
  g.__orgtableInstanceId ?? Math.random().toString(36).slice(2);
g.__orgtableInstanceId = INSTANCE_ID;

export type BoardEvent = { type: "board:changed"; boardId: string; at: number };
// Per-user event: a "ping" so the tab reloads its notifications. It carries no content,
// it only signals that there is something new.
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

/** Subscribes to a board's changes. Returns the unsubscribe function. */
export function subscribeBoard(
  boardId: string,
  handler: (event: BoardEvent) => void,
): () => void {
  emitter.on(channelFor(boardId), handler);
  void ensurePgBridge();
  return () => emitter.off(channelFor(boardId), handler);
}

/** Subscribes to a user's events (notifications). Returns the unsubscribe function. */
export function subscribeUser(
  userId: string,
  handler: (event: UserEvent) => void,
): () => void {
  emitter.on(channelForUser(userId), handler);
  void ensurePgBridge();
  return () => emitter.off(channelForUser(userId), handler);
}

/** Publishes that a board changed. Server Actions call it after every mutation. */
export async function publishBoardEvent(boardId: string): Promise<void> {
  emitLocal(boardId);
  if (PG_NOTIFY_ENABLED) {
    await publishCrossInstance({ kind: "board", id: boardId }).catch(
      (err: unknown) => {
        // A bridge failure must never break the mutation: in-process delivery still works.
        console.error("[realtime] could not publish on the LISTEN/NOTIFY bridge", {
          kind: "board",
          id: boardId,
        }, err);
      },
    );
  }
}

/** Publishes that a user has a new notification (live delivery). */
export async function publishUserEvent(userId: string): Promise<void> {
  emitLocalUser(userId);
  if (PG_NOTIFY_ENABLED) {
    await publishCrossInstance({ kind: "user", id: userId }).catch(
      (err: unknown) => {
        // Best-effort: in-process delivery has already emitted locally.
        console.error("[realtime] could not publish on the LISTEN/NOTIFY bridge", {
          kind: "user",
          id: userId,
        }, err);
      },
    );
  }
}

// --- Optional PostgreSQL LISTEN/NOTIFY bridge (multi-instance) ---

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

// Anyone with database access can NOTIFY on the channel: the payload is validated rather
// than trusted through a cast (a payload without an id would emit on "board:undefined").
const bridgePayloadSchema = z.object({
  kind: z.enum(["board", "user"]),
  id: z.string().min(1),
  origin: z.string().min(1),
});
export type BridgePayload = z.infer<typeof bridgePayloadSchema>;

/** Parses and validates a NOTIFY payload. Returns null if it is invalid. */
export function parseBridgePayload(raw: string): BridgePayload | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    // Not JSON: treated the same as an invalid structure.
    return null;
  }
  const parsed = bridgePayloadSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

function handleBridgeNotification(raw: string | undefined): void {
  if (!raw) return;
  const data = parseBridgePayload(raw);
  if (!data) {
    // The payload is not dumped: it may come from anyone with database access.
    console.warn(
      `[realtime] NOTIFY discarded: not JSON or no valid { kind, id, origin } (${raw.length} characters)`,
    );
    return;
  }
  // Ignores events from this instance: they were already emitted locally.
  if (data.origin === INSTANCE_ID) return;
  if (data.kind === "user") emitLocalUser(data.id);
  else emitLocal(data.id);
}

function closeClient(client: Client): void {
  client.end().catch((err: unknown) => {
    console.error("[realtime] could not close the LISTEN/NOTIFY bridge connection", err);
  });
}

// The bridge connection dropped: close it (otherwise each retry would open another
// connection until Postgres runs out) and schedule a reconnect. Only acts when `client` is
// the active one, so an "error" followed by "end" does not do it twice.
function dropPgClient(client: Client): void {
  if (g.__orgtablePgClient !== client) return;
  g.__orgtablePgClient = undefined;
  closeClient(client);
  scheduleReconnect();
}

// Reconnect with exponential backoff (1 s → 30 s) and a single timer. Not scheduled when
// no subscriber is left: the next subscription starts the bridge.
function scheduleReconnect(): void {
  if (g.__orgtablePgReconnectTimer) return;
  if (emitter.eventNames().length === 0) return;
  const attempt = g.__orgtablePgReconnectAttempt ?? 0;
  const delay = Math.min(RECONNECT_MIN_MS * 2 ** attempt, RECONNECT_MAX_MS);
  g.__orgtablePgReconnectAttempt = attempt + 1;
  const timer = setTimeout(() => {
    g.__orgtablePgReconnectTimer = undefined;
    // Everyone unsubscribed during the wait: no connection needed.
    if (emitter.eventNames().length === 0) return;
    void ensurePgBridge();
  }, delay);
  // Does not keep the process alive just for this retry.
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
      console.error("[realtime] error on the LISTEN/NOTIFY bridge connection", err);
      dropPgClient(current);
    });
    current.on("end", () => {
      if (g.__orgtablePgClient === current) {
        console.error("[realtime] the LISTEN/NOTIFY bridge connection closed");
      }
      dropPgClient(current);
    });
    await current.connect();
    await current.query(`LISTEN ${CHANNEL}`);
    g.__orgtablePgClient = current;
    g.__orgtablePgReconnectAttempt = 0;
  } catch (err) {
    // pg's error does not include the password; DATABASE_URL is never logged.
    console.error("[realtime] could not start the LISTEN/NOTIFY bridge", err);
    if (client) closeClient(client);
    scheduleReconnect();
  }
}

function ensurePgBridge(): Promise<void> {
  if (!PG_NOTIFY_ENABLED) return Promise.resolve();
  if (g.__orgtablePgClient) return Promise.resolve();
  // With a reconnect scheduled the backoff is honoured: no other connection is opened.
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
  // Waits for a start-up in progress: previously, while the state was "starting", the
  // event was dropped without being published.
  await ensurePgBridge();
  const client = g.__orgtablePgClient;
  if (!client) return;
  const payload = JSON.stringify({ ...target, origin: INSTANCE_ID });
  await client.query("SELECT pg_notify($1, $2)", [CHANNEL, payload]);
}
