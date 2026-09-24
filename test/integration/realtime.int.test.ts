import type { EventEmitter } from "node:events";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import { prisma } from "@/app/lib/prisma";
import { createSession } from "@/app/lib/session";
import { publishBoardEvent, publishUserEvent } from "@/app/lib/realtime/bus";
import { HEARTBEAT_MS, MAX_STREAM_MS } from "@/app/lib/realtime/sse";
import { GET as boardStream } from "@/app/api/boards/[id]/stream/route";
import { GET as notificationsStream } from "@/app/api/notifications/stream/route";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  addMember,
  ctx,
} from "./helpers";

// Streams SSE de tiempo real: autorización (401/403), limpieza de la suscripción y del
// latido al cortar la conexión, y cierre del stream cuando se revoca la sesión o se
// retira el acceso. Antes nada lo comprobaba y una regresión acumulaba listeners en el
// bus sin que nadie se enterara.

// Tarro de cookies en memoria: createSession escribe la cookie de sesión y
// verifySession la lee, igual que en una petición real.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
}));

const bus = () =>
  (globalThis as { __orgtableBus?: EventEmitter }).__orgtableBus;
const listeners = (channel: string) => bus()?.listenerCount(channel) ?? 0;

async function loginAs(userId: string): Promise<string> {
  jar.clear();
  await createSession(userId);
  const session = await prisma.session.findFirstOrThrow({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return session.id;
}

type Reader = ReadableStreamDefaultReader<Uint8Array>;
const decoder = new TextDecoder();

async function readChunk(reader: Reader): Promise<string> {
  const { value, done } = await reader.read();
  if (done) throw new Error("El stream se cerró antes de tiempo");
  return decoder.decode(value);
}

async function readUntil(reader: Reader, needle: string): Promise<string> {
  let text = "";
  while (!text.includes(needle)) text += await readChunk(reader);
  return text;
}

/** Lee hasta el final; si el stream no se cierra, el test acaba por timeout. */
async function readToEnd(reader: Reader): Promise<string> {
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return text;
    text += decoder.decode(value);
  }
}

function streamRequest(url: string, signal?: AbortSignal): Request {
  return new Request(`http://test${url}`, { signal });
}

const aborters: AbortController[] = [];
function openController(): AbortController {
  const ac = new AbortController();
  aborters.push(ac);
  return ac;
}

beforeEach(async () => {
  await resetDb();
  jar.clear();
  vi.stubEnv("SESSION_SECRET", "secreto-de-test-con-longitud-suficiente");
  // Solo el latido (setInterval) y el reloj: la BD sigue usando temporizadores reales.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
});

afterEach(() => {
  // Abortar siempre, aunque el test falle, para no dejar streams vivos en el bus.
  for (const ac of aborters.splice(0)) ac.abort();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await disconnect();
});

describe("GET /api/boards/[id]/stream", () => {
  it("401 sin sesión", async () => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    const res = await boardStream(
      streamRequest(`/api/boards/${board.id}/stream`),
      ctx({ id: board.id }),
    );
    expect(res.status).toBe(401);
    expect(listeners(`board:${board.id}`)).toBe(0);
  });

  it("403 si no es miembro del tablero", async () => {
    const owner = await seedUser();
    const outsider = await seedUser();
    const board = await seedBoard(owner.id);
    await loginAs(outsider.id);
    const res = await boardStream(
      streamRequest(`/api/boards/${board.id}/stream`),
      ctx({ id: board.id }),
    );
    expect(res.status).toBe(403);
    expect(listeners(`board:${board.id}`)).toBe(0);
  });

  it("un miembro recibe los cambios y al abortar se libera el listener y el latido", async () => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    await loginAs(owner.id);
    const ac = openController();
    const res = await boardStream(
      streamRequest(`/api/boards/${board.id}/stream`, ac.signal),
      ctx({ id: board.id }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const reader = res.body!.getReader();

    expect(await readChunk(reader)).toBe(": connected\n\n");
    expect(listeners(`board:${board.id}`)).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    await publishBoardEvent(board.id);
    const text = await readUntil(reader, "event: change");
    expect(text).toContain(`"boardId":"${board.id}"`);

    ac.abort();
    expect(await readToEnd(reader)).not.toContain("event: change");
    expect(listeners(`board:${board.id}`)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("si la petición ya llegó abortada no se suscribe", async () => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    await loginAs(owner.id);
    const res = await boardStream(
      streamRequest(`/api/boards/${board.id}/stream`, AbortSignal.abort()),
      ctx({ id: board.id }),
    );
    expect(res.status).toBe(204);
    expect(listeners(`board:${board.id}`)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancelar el body libera el listener y el latido", async () => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    await loginAs(owner.id);
    const ac = openController();
    const res = await boardStream(
      streamRequest(`/api/boards/${board.id}/stream`, ac.signal),
      ctx({ id: board.id }),
    );
    const reader = res.body!.getReader();
    await readChunk(reader);
    await reader.cancel();
    expect(listeners(`board:${board.id}`)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("se cierra en el siguiente latido si se revoca la sesión", async () => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    const sessionId = await loginAs(owner.id);
    const ac = openController();
    const res = await boardStream(
      streamRequest(`/api/boards/${board.id}/stream`, ac.signal),
      ctx({ id: board.id }),
    );
    const reader = res.body!.getReader();
    await readChunk(reader);

    await prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

    await readToEnd(reader);
    expect(listeners(`board:${board.id}`)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("se cierra en el siguiente latido si expulsan a la persona del tablero", async () => {
    const owner = await seedUser();
    const editor = await seedUser();
    const board = await seedBoard(owner.id);
    await addMember(board.id, editor.id, "EDITOR");
    await loginAs(editor.id);
    const ac = openController();
    const res = await boardStream(
      streamRequest(`/api/boards/${board.id}/stream`, ac.signal),
      ctx({ id: board.id }),
    );
    const reader = res.body!.getReader();
    await readChunk(reader);

    await prisma.boardMember.delete({
      where: { boardId_userId: { boardId: board.id, userId: editor.id } },
    });
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

    await readToEnd(reader);
    expect(listeners(`board:${board.id}`)).toBe(0);
  });

  it("sigue abierto tras el latido si el acceso es válido y se cierra al llegar a la vida máxima", async () => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    await loginAs(owner.id);
    const ac = openController();
    const res = await boardStream(
      streamRequest(`/api/boards/${board.id}/stream`, ac.signal),
      ctx({ id: board.id }),
    );
    const reader = res.body!.getReader();
    await readChunk(reader);

    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
    expect(await readUntil(reader, ": ping")).toContain(": ping");
    expect(listeners(`board:${board.id}`)).toBe(1);

    await vi.advanceTimersByTimeAsync(MAX_STREAM_MS);
    await readToEnd(reader);
    expect(listeners(`board:${board.id}`)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("GET /api/notifications/stream", () => {
  it("401 sin sesión", async () => {
    const res = await notificationsStream(
      streamRequest("/api/notifications/stream"),
    );
    expect(res.status).toBe(401);
  });

  it("recibe los avisos del usuario y al abortar se libera el listener", async () => {
    const user = await seedUser();
    await loginAs(user.id);
    const ac = openController();
    const res = await notificationsStream(
      streamRequest("/api/notifications/stream", ac.signal),
    );
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    expect(await readChunk(reader)).toBe(": connected\n\n");
    expect(listeners(`user:${user.id}`)).toBe(1);

    await publishUserEvent(user.id);
    expect(await readUntil(reader, "event: notification")).toContain(
      `"userId":"${user.id}"`,
    );

    ac.abort();
    await readToEnd(reader);
    expect(listeners(`user:${user.id}`)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("si la petición ya llegó abortada no se suscribe", async () => {
    const user = await seedUser();
    await loginAs(user.id);
    const res = await notificationsStream(
      streamRequest("/api/notifications/stream", AbortSignal.abort()),
    );
    expect(res.status).toBe(204);
    expect(listeners(`user:${user.id}`)).toBe(0);
  });

  it("se cierra en el siguiente latido si se revoca la sesión", async () => {
    const user = await seedUser();
    const sessionId = await loginAs(user.id);
    const ac = openController();
    const res = await notificationsStream(
      streamRequest("/api/notifications/stream", ac.signal),
    );
    const reader = res.body!.getReader();
    await readChunk(reader);

    await prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

    await readToEnd(reader);
    expect(listeners(`user:${user.id}`)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
