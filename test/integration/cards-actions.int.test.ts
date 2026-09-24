import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { moveCard } from "@/app/lib/actions/cards";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedList,
  seedCard,
  addMember,
  loginAs,
} from "./helpers";

// moveCard ejecutado de verdad (Server Action con sesión): regresión del IDOR de la
// auditoría de seguridad. Si se quita la comprobación cardBelongsToBoard de
// app/lib/actions/cards.ts, el primer test falla.

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

async function scenario() {
  const ownerA = await seedUser();
  const ownerB = await seedUser();
  const editor = await seedUser();
  const boardA = await seedBoard(ownerA.id, "A");
  const boardB = await seedBoard(ownerB.id, "B");
  await addMember(boardB.id, editor.id, "EDITOR");
  const listA = await seedList(boardA.id);
  const listB1 = await seedList(boardB.id);
  const listB2 = await seedList(boardB.id);
  const cardA = await seedCard(listA.id);
  const cardB = await seedCard(listB1.id);
  return { ownerB, editor, boardB, listA, listB1, listB2, cardA, cardB };
}

describe("moveCard (Server Action)", () => {
  it("un EDITOR de B no puede traerse una tarjeta del tablero A, al que no tiene acceso", async () => {
    const { editor, listA, listB1, cardA } = await scenario();
    await loginAs(editor.id);

    const result = await moveCard({ cardId: cardA.id, toListId: listB1.id, position: "a5" });

    expect(result).toEqual({ ok: false });
    const card = await prisma.card.findUniqueOrThrow({ where: { id: cardA.id } });
    expect(card.listId).toBe(listA.id);
  });

  it("un EDITOR mueve tarjetas entre listas de su tablero", async () => {
    const { editor, listB2, cardB } = await scenario();
    await loginAs(editor.id);

    const result = await moveCard({ cardId: cardB.id, toListId: listB2.id, position: "a5" });

    expect(result).toEqual({ ok: true });
    const card = await prisma.card.findUniqueOrThrow({ where: { id: cardB.id } });
    expect(card.listId).toBe(listB2.id);
  });

  it("un VIEWER no puede mover", async () => {
    const { boardB, listB1, listB2, cardB } = await scenario();
    const viewer = await seedUser();
    await addMember(boardB.id, viewer.id, "VIEWER");
    await loginAs(viewer.id);

    expect(
      await moveCard({ cardId: cardB.id, toListId: listB2.id, position: "a5" }),
    ).toEqual({ ok: false });
    const card = await prisma.card.findUniqueOrThrow({ where: { id: cardB.id } });
    expect(card.listId).toBe(listB1.id);
  });

  it("quien no es miembro es redirigido a /boards", async () => {
    const { listB2, cardB, listB1 } = await scenario();
    const stranger = await seedUser();
    await loginAs(stranger.id);

    await expect(
      moveCard({ cardId: cardB.id, toListId: listB2.id, position: "a5" }),
    ).rejects.toMatchObject({ digest: expect.stringContaining(";/boards;") });
    const card = await prisma.card.findUniqueOrThrow({ where: { id: cardB.id } });
    expect(card.listId).toBe(listB1.id);
  });

  it("sin sesión es redirigido a /login", async () => {
    const { listB2, cardB } = await scenario();
    await expect(
      moveCard({ cardId: cardB.id, toListId: listB2.id, position: "a5" }),
    ).rejects.toMatchObject({ digest: expect.stringContaining(";/login;") });
  });
});
