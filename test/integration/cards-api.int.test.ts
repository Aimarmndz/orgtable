import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
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

describe("API v1 — listas y tarjetas (integración)", () => {
  it("un editor crea una lista y una tarjeta con vencimiento", async () => {
    const owner = await seedUser();
    const token = await seedApiToken(owner.id);
    const board = await seedBoard(owner.id);

    const listRes = await createList(
      apiRequest("POST", `/api/v1/boards/${board.id}/lists`, {
        token,
        body: { title: "Pendiente" },
      }),
      ctx({ id: board.id }),
    );
    expect(listRes.status).toBe(201);
    const list = await listRes.json();
    expect(list.title).toBe("Pendiente");

    const cardRes = await createCard(
      apiRequest("POST", `/api/v1/lists/${list.id}/cards`, {
        token,
        body: { title: "Hacer X", dueDate: "2026-07-01" },
      }),
      ctx({ id: list.id }),
    );
    expect(cardRes.status).toBe(201);
    const card = await cardRes.json();
    expect(card.title).toBe("Hacer X");
    expect(card.dueDate).toBe("2026-07-01T00:00:00.000Z");

    const inDb = await prisma.card.findUnique({ where: { id: card.id } });
    expect(inDb?.listId).toBe(list.id);
  });

  it("un VIEWER no puede crear listas (403)", async () => {
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

  it("un usuario sin acceso recibe 404 (no se revela el tablero)", async () => {
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

  it("PATCH actualiza el título y limpia el vencimiento; DELETE borra la tarjeta", async () => {
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
        body: { title: "Editada", dueDate: null },
      }),
      ctx({ id: card.id }),
    );
    expect(patchRes.status).toBe(200);
    const patched = await patchRes.json();
    expect(patched.title).toBe("Editada");
    expect(patched.dueDate).toBeNull();

    const delRes = await deleteCard(
      apiRequest("DELETE", `/api/v1/cards/${card.id}`, { token }),
      ctx({ id: card.id }),
    );
    expect(delRes.status).toBe(200);
    expect(await prisma.card.findUnique({ where: { id: card.id } })).toBeNull();
  });
});
