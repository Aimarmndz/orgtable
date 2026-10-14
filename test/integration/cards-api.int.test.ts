import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { POST as createList } from "@/app/api/v1/boards/[id]/lists/route";
import {
  GET as listCards,
  POST as createCard,
} from "@/app/api/v1/lists/[id]/cards/route";
import {
  GET as getCard,
  PATCH as patchCard,
  DELETE as deleteCard,
} from "@/app/api/v1/cards/[id]/route";
import {
  resetDb,
  disconnect,
  seedUser,
  seedApiToken,
  seedBoard,
  seedList,
  seedCard,
  addMember,
  apiRequest,
  ctx,
} from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

describe("API v1 — lists and cards (integration)", () => {
  it("an editor creates a list and a card with a due date", async () => {
    const owner = await seedUser();
    const token = await seedApiToken(owner.id);
    const board = await seedBoard(owner.id);

    const listRes = await createList(
      apiRequest("POST", `/api/v1/boards/${board.id}/lists`, {
        token,
        body: { title: "To do" },
      }),
      ctx({ id: board.id }),
    );
    expect(listRes.status).toBe(201);
    const list = await listRes.json();
    expect(list.title).toBe("To do");

    const cardRes = await createCard(
      apiRequest("POST", `/api/v1/lists/${list.id}/cards`, {
        token,
        body: { title: "Do X", dueDate: "2026-07-01" },
      }),
      ctx({ id: list.id }),
    );
    expect(cardRes.status).toBe(201);
    const card = await cardRes.json();
    expect(card.title).toBe("Do X");
    expect(card.dueDate).toBe("2026-07-01T00:00:00.000Z");

    const inDb = await prisma.card.findUnique({ where: { id: card.id } });
    expect(inDb?.listId).toBe(list.id);
  });

  it("a VIEWER cannot create lists (403)", async () => {
    const owner = await seedUser();
    const viewer = await seedUser();
    const board = await seedBoard(owner.id);
    await addMember(board.id, viewer.id, "VIEWER");
    const token = await seedApiToken(viewer.id);

    const res = await createList(
      apiRequest("POST", `/api/v1/boards/${board.id}/lists`, {
        token,
        body: { title: "Nope" },
      }),
      ctx({ id: board.id }),
    );
    expect(res.status).toBe(403);
    expect(await prisma.list.count()).toBe(0);
  });

  it("a user without access gets 404 (the board is not revealed)", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const board = await seedBoard(owner.id);
    const token = await seedApiToken(stranger.id);

    const res = await createList(
      apiRequest("POST", `/api/v1/boards/${board.id}/lists`, {
        token,
        body: { title: "Nope" },
      }),
      ctx({ id: board.id }),
    );
    expect(res.status).toBe(404);
  });

  it("PATCH updates the title and clears the due date; DELETE removes the card", async () => {
    const owner = await seedUser();
    const token = await seedApiToken(owner.id);
    const board = await seedBoard(owner.id);
    const list = await seedList(board.id);

    const cardRes = await createCard(
      apiRequest("POST", `/api/v1/lists/${list.id}/cards`, {
        token,
        body: { title: "Original", dueDate: "2026-07-01" },
      }),
      ctx({ id: list.id }),
    );
    const card = await cardRes.json();

    const patchRes = await patchCard(
      apiRequest("PATCH", `/api/v1/cards/${card.id}`, {
        token,
        body: { title: "Edited", dueDate: null },
      }),
      ctx({ id: card.id }),
    );
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.title).toBe("Edited");
    expect(patched.dueDate).toBeNull();

    const delRes = await deleteCard(
      apiRequest("DELETE", `/api/v1/cards/${card.id}`, { token }),
      ctx({ id: card.id }),
    );
    expect(delRes.status).toBe(200);
    expect(await prisma.card.findUnique({ where: { id: card.id } })).toBeNull();
  });
});

/** Card with a due date, its owner, and the tokens of a VIEWER and of a stranger. */
async function seedCardWithRoles() {
  const owner = await seedUser();
  const viewer = await seedUser();
  const stranger = await seedUser();
  const board = await seedBoard(owner.id);
  await addMember(board.id, viewer.id, "VIEWER");
  const list = await seedList(board.id);
  const card = await seedCard(list.id);
  await prisma.card.update({
    where: { id: card.id },
    data: { dueDate: new Date("2026-07-01T00:00:00.000Z") },
  });
  return {
    list,
    card,
    ownerToken: await seedApiToken(owner.id),
    viewerToken: await seedApiToken(viewer.id),
    strangerToken: await seedApiToken(stranger.id),
  };
}

function patch(cardId: string, token: string, body: unknown) {
  return patchCard(
    apiRequest("PATCH", `/api/v1/cards/${cardId}`, { token, body }),
    ctx({ id: cardId }),
  );
}

async function dueDateOf(cardId: string) {
  const card = await prisma.card.findUniqueOrThrow({
    where: { id: cardId },
    select: { dueDate: true },
  });
  return card.dueDate?.toISOString() ?? null;
}

describe("API v1 — cards: roles and access", () => {
  it("PATCH and DELETE by a VIEWER give 403 and change nothing", async () => {
    const { card, viewerToken } = await seedCardWithRoles();
    expect((await patch(card.id, viewerToken, { title: "X" })).status).toBe(403);
    const del = await deleteCard(
      apiRequest("DELETE", `/api/v1/cards/${card.id}`, { token: viewerToken }),
      ctx({ id: card.id }),
    );
    expect(del.status).toBe(403);
    expect(await prisma.card.findUnique({ where: { id: card.id } })).not.toBeNull();
  });

  it("a stranger gets 404 on GET, PATCH and DELETE of the card and on GET of the list", async () => {
    const { list, card, strangerToken } = await seedCardWithRoles();
    const token = strangerToken;
    const get = await getCard(
      apiRequest("GET", `/api/v1/cards/${card.id}`, { token }),
      ctx({ id: card.id }),
    );
    const list404 = await listCards(
      apiRequest("GET", `/api/v1/lists/${list.id}/cards`, { token }),
      ctx({ id: list.id }),
    );
    const del = await deleteCard(
      apiRequest("DELETE", `/api/v1/cards/${card.id}`, { token }),
      ctx({ id: card.id }),
    );
    expect(get.status).toBe(404);
    expect(list404.status).toBe(404);
    expect((await patch(card.id, token, { title: "X" })).status).toBe(404);
    expect(del.status).toBe(404);
    expect(await prisma.card.count()).toBe(1);
  });
});

// Regression: an unrecognisable dueDate was stored as null (clearing the due date) and
// the response was 200/201.
describe("API v1 — cards: dueDate validation", () => {
  it.each(["31/12/2026", "2026-02-31", "", "tomorrow"])(
    "PATCH with dueDate %j gives 422 and keeps the date",
    async (bad) => {
      const { card, ownerToken } = await seedCardWithRoles();
      const res = await patch(card.id, ownerToken, { dueDate: bad });
      expect(res.status).toBe(422);
      expect(await dueDateOf(card.id)).toBe("2026-07-01T00:00:00.000Z");
    },
  );

  it("POST with an invalid dueDate gives 422 and creates nothing", async () => {
    const { list, ownerToken } = await seedCardWithRoles();
    const res = await createCard(
      apiRequest("POST", `/api/v1/lists/${list.id}/cards`, {
        token: ownerToken,
        body: { title: "New", dueDate: "31/12/2026" },
      }),
      ctx({ id: list.id }),
    );
    expect(res.status).toBe(422);
    expect(await prisma.card.count()).toBe(1);
  });

  it("'YYYY-MM-DD', ISO with a time zone and null still work", async () => {
    const { card, ownerToken } = await seedCardWithRoles();
    expect((await patch(card.id, ownerToken, { dueDate: "2026-08-15" })).status).toBe(200);
    expect(await dueDateOf(card.id)).toBe("2026-08-15T00:00:00.000Z");

    expect(
      (await patch(card.id, ownerToken, { dueDate: "2026-08-15T10:00:00+02:00" })).status,
    ).toBe(200);
    expect(await dueDateOf(card.id)).toBe("2026-08-15T08:00:00.000Z");

    expect((await patch(card.id, ownerToken, { dueDate: null })).status).toBe(200);
    expect(await dueDateOf(card.id)).toBeNull();
  });
});
