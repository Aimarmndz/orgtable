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
  loginAs,
} from "./helpers";

// Real-time SSE streams: authorization (401/403), cleanup of the subscription and the
// heartbeat when the connection drops, and closing the stream when the session is revoked
// or access is withdrawn. Nothing checked this before, and a regression piled up listeners
// on the bus without anyone noticing.

const bus = () =>
  (globalThis as { __orgtableBus?: EventEmitter }).__orgtableBus;
const listeners = (channel: string) => bus()?.listenerCount(channel) ?? 0;

async function loginAndGetSessionId(userId: string): Promise<string> {
  await loginAs(userId);
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
  if (done) throw new Error("The stream closed too early");
  return decoder.decode(value);
}

async function readUntil(reader: Reader, needle: string): Promise<string> {
  let text = "";
  while (!text.includes(needle)) text += await readChunk(reader);
  return text;
}

/** Reads to the end; if the stream does not close, the test ends with a timeout. */
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
  // Only the heartbeat (setInterval) and the clock: the DB keeps using real timers.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
});

afterEach(() => {
  // Always abort, even if the test fails, so no live streams are left on the bus.
  for (const ac of aborters.splice(0)) ac.abort();
  vi.useRealTimers();
});

afterAll(async () => {
  await disconnect();
});

describe("GET /api/boards/[id]/stream", () => {
  it("401 without a session", async () => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    const res = await boardStream(
      streamRequest(`/api/boards/${board.id}/stream`),
      ctx({ id: board.id }),
    );
    expect(res.status).toBe(401);
    expect(listeners(`board:${board.id}`)).toBe(0);
  });

  it("403 if not a board member", async () => {
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

  it("a member receives the changes, and aborting frees the listener and the heartbeat", async () => {
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

  it("does not subscribe if the request arrived already aborted", async () => {
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

  it("cancelling the body frees the listener and the heartbeat", async () => {
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

  it("closes on the next heartbeat if the session is revoked", async () => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    const sessionId = await loginAndGetSessionId(owner.id);
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

  it("closes on the next heartbeat if the person is removed from the board", async () => {
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

  it("stays open after the heartbeat if access is valid and closes when it reaches its maximum lifetime", async () => {
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
  it("401 without a session", async () => {
    const res = await notificationsStream(
      streamRequest("/api/notifications/stream"),
    );
    expect(res.status).toBe(401);
  });

  it("receives the user's notifications, and aborting frees the listener", async () => {
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

  it("does not subscribe if the request arrived already aborted", async () => {
    const user = await seedUser();
    await loginAs(user.id);
    const res = await notificationsStream(
      streamRequest("/api/notifications/stream", AbortSignal.abort()),
    );
    expect(res.status).toBe(204);
    expect(listeners(`user:${user.id}`)).toBe(0);
  });

  it("closes on the next heartbeat if the session is revoked", async () => {
    const user = await seedUser();
    const sessionId = await loginAndGetSessionId(user.id);
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
