import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { moveCard } from "@/app/lib/actions/cards";
import { reorderList } from "@/app/lib/actions/lists";
import { POST as createCardApi } from "@/app/api/v1/lists/[id]/cards/route";
import { POST as createListApi } from "@/app/api/v1/boards/[id]/lists/route";
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
  loginAs,
} from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

// Claves que antes se guardaban tal cual y dejaban la lista o el tablero sin poder crear
// nada (positionAtEnd lanzaba con ellas). 123 simula un cliente que envía un número.
const BAD_POSITIONS: unknown[] = ["x", "", 123, "a".repeat(10_000), "a0 ", "zzzz~"];

describe("posiciones: moveCard y reorderList validan la clave", () => {
  it.each(BAD_POSITIONS)("moveCard con %j da ok:false y no toca la BD", async (bad) => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    const list = await seedList(board.id);
    const card = await seedCard(list.id);
    const before = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    await loginAs(owner.id);

    const res = await moveCard({
      cardId: card.id,
      toListId: list.id,
      position: bad as string,
    });
    expect(res).toEqual({ ok: false });
    const after = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    expect(after.position).toBe(before.position);

    // La lista sigue admitiendo altas al final.
    const token = await seedApiToken(owner.id);
    const created = await createCardApi(
      apiRequest("POST", `/api/v1/lists/${list.id}/cards`, {
        token,
        body: { title: "Otra" },
      }),
      ctx({ id: list.id }),
    );
    expect(created.status).toBe(201);
  });

  it.each(BAD_POSITIONS)("reorderList con %j da ok:false y no toca la BD", async (bad) => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    const list = await seedList(board.id);
    const before = await prisma.list.findUniqueOrThrow({ where: { id: list.id } });
    await loginAs(owner.id);

    const res = await reorderList({ listId: list.id, position: bad as string });
    expect(res).toEqual({ ok: false });
    const after = await prisma.list.findUniqueOrThrow({ where: { id: list.id } });
    expect(after.position).toBe(before.position);

    const token = await seedApiToken(owner.id);
    const created = await createListApi(
      apiRequest("POST", `/api/v1/boards/${board.id}/lists`, {
        token,
        body: { title: "Otra" },
      }),
      ctx({ id: board.id }),
    );
    expect(created.status).toBe(201);
  });

  it("una clave válida se guarda (moveCard y reorderList)", async () => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    const listA = await seedList(board.id);
    const listB = await seedList(board.id);
    const card = await seedCard(listA.id);
    await loginAs(owner.id);

    expect(
      await moveCard({ cardId: card.id, toListId: listB.id, position: "a0V" }),
    ).toEqual({ ok: true });
    const moved = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    expect(moved.listId).toBe(listB.id);
    expect(moved.position).toBe("a0V");

    expect(await reorderList({ listId: listB.id, position: "Zz" })).toEqual({ ok: true });
    const reordered = await prisma.list.findUniqueOrThrow({ where: { id: listB.id } });
    expect(reordered.position).toBe("Zz");
  });
});

// Regresión: leer la última posición y crear eran dos pasos sin bloqueo, así que altas
// simultáneas guardaban la misma clave.
describe("posiciones: altas concurrentes al final", () => {
  it("10 POST en paralelo a /lists/:id/cards dan 10 posiciones distintas", async () => {
    const owner = await seedUser();
    const token = await seedApiToken(owner.id);
    const board = await seedBoard(owner.id);
    const list = await seedList(board.id);

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createCardApi(
          apiRequest("POST", `/api/v1/lists/${list.id}/cards`, {
            token,
            body: { title: `T${i}` },
          }),
          ctx({ id: list.id }),
        ),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(201));

    const cards = await prisma.card.findMany({
      where: { listId: list.id },
      orderBy: { position: "asc" },
      select: { position: true },
    });
    const positions = cards.map((c) => c.position);
    expect(new Set(positions).size).toBe(10);
    expect(positions).toEqual([...positions].sort());
  });

  it("10 POST en paralelo a /boards/:id/lists dan 10 posiciones distintas", async () => {
    const owner = await seedUser();
    const token = await seedApiToken(owner.id);
    const board = await seedBoard(owner.id);

    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createListApi(
          apiRequest("POST", `/api/v1/boards/${board.id}/lists`, {
            token,
            body: { title: `L${i}` },
          }),
          ctx({ id: board.id }),
        ),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(201));

    const lists = await prisma.list.findMany({
      where: { boardId: board.id },
      select: { position: true },
    });
    expect(new Set(lists.map((l) => l.position)).size).toBe(10);
  });
});
