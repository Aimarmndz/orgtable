import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { GET as listBoards, POST as createBoard } from "@/app/api/v1/boards/route";
import {
  PATCH as patchBoard,
  DELETE as deleteBoard,
} from "@/app/api/v1/boards/[id]/route";
import { POST as createList } from "@/app/api/v1/boards/[id]/lists/route";
import { POST as createCard } from "@/app/api/v1/lists/[id]/cards/route";
import { PATCH as patchCard, DELETE as deleteCard } from "@/app/api/v1/cards/[id]/route";
import {
  resetDb,
  disconnect,
  seedUser,
  seedApiToken,
  seedBoard,
  seedList,
  seedCard,
  apiRequest,
  ctx,
} from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

describe("API v1 — token scope and expiry (integration)", () => {
  it("a read-only token can READ but not WRITE (403)", async () => {
    const user = await seedUser();
    const token = await seedApiToken(user.id, { scope: "read" });

    const read = await listBoards(
      apiRequest("GET", "/api/v1/boards", { token }),
    );
    expect(read.status).toBe(200);

    const write = await createBoard(
      apiRequest("POST", "/api/v1/boards", { token, body: { title: "X" } }),
    );
    expect(write.status).toBe(403);
  });

  it("a token with full scope can write", async () => {
    const user = await seedUser();
    const token = await seedApiToken(user.id, { scope: "full" });
    const res = await createBoard(
      apiRequest("POST", "/api/v1/boards", { token, body: { title: "OK" } }),
    );
    expect(res.status).toBe(201);
  });

  it("an expired token is rejected (401)", async () => {
    const user = await seedUser();
    const token = await seedApiToken(user.id, {
      expiresAt: new Date(Date.now() - 1000), // already expired
    });
    const res = await listBoards(
      apiRequest("GET", "/api/v1/boards", { token }),
    );
    expect(res.status).toBe(401);
  });
});

// Snapshot of everything a write handler could change.
async function snapshot() {
  const [boards, lists, cards] = await Promise.all([
    prisma.board.findMany({ orderBy: { id: "asc" }, select: { id: true, title: true } }),
    prisma.list.findMany({ orderBy: { id: "asc" }, select: { id: true, title: true } }),
    prisma.card.findMany({
      orderBy: { id: "asc" },
      select: { id: true, title: true, dueDate: true },
    }),
  ]);
  return { boards, lists, cards };
}

type Ids = { boardId: string; listId: string; cardId: string };

// Every write handler, with a VALID body: the 403 must come from the scope, not from
// validation.
const WRITE_HANDLERS: [string, (token: string, ids: Ids) => Promise<Response>][] = [
  [
    "PATCH /boards/:id",
    (token, { boardId }) =>
      patchBoard(
        apiRequest("PATCH", `/api/v1/boards/${boardId}`, { token, body: { title: "New" } }),
        ctx({ id: boardId }),
      ),
  ],
  [
    "DELETE /boards/:id",
    (token, { boardId }) =>
      deleteBoard(
        apiRequest("DELETE", `/api/v1/boards/${boardId}`, { token }),
        ctx({ id: boardId }),
      ),
  ],
  [
    "POST /boards/:id/lists",
    (token, { boardId }) =>
      createList(
        apiRequest("POST", `/api/v1/boards/${boardId}/lists`, { token, body: { title: "L" } }),
        ctx({ id: boardId }),
      ),
  ],
  [
    "POST /lists/:id/cards",
    (token, { listId }) =>
      createCard(
        apiRequest("POST", `/api/v1/lists/${listId}/cards`, { token, body: { title: "T" } }),
        ctx({ id: listId }),
      ),
  ],
  [
    "PATCH /cards/:id",
    (token, { cardId }) =>
      patchCard(
        apiRequest("PATCH", `/api/v1/cards/${cardId}`, { token, body: { title: "New" } }),
        ctx({ id: cardId }),
      ),
  ],
  [
    "DELETE /cards/:id",
    (token, { cardId }) =>
      deleteCard(
        apiRequest("DELETE", `/api/v1/cards/${cardId}`, { token }),
        ctx({ id: cardId }),
      ),
  ],
];

describe("API v1 — a read-only token writes through no handler", () => {
  it.each(WRITE_HANDLERS)("%s gives 403 and the DB does not change", async (_name, call) => {
    const owner = await seedUser();
    const token = await seedApiToken(owner.id, { scope: "read" });
    const board = await seedBoard(owner.id);
    const list = await seedList(board.id);
    const card = await seedCard(list.id);
    const before = await snapshot();

    const res = await call(token, { boardId: board.id, listId: list.id, cardId: card.id });
    expect(res.status).toBe(403);
    expect(await snapshot()).toEqual(before);
  });
});
