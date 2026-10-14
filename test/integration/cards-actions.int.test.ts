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

// moveCard run for real (Server Action with a session): regression test for the IDOR
// found in the security audit. If the cardBelongsToBoard check is removed from
// app/lib/actions/cards.ts, the first test fails.

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
  it("an EDITOR of B cannot pull in a card from board A, which they cannot access", async () => {
    const { editor, listA, listB1, cardA } = await scenario();
    await loginAs(editor.id);

    const result = await moveCard({ cardId: cardA.id, toListId: listB1.id, position: "a5" });

    expect(result).toEqual({ ok: false });
    const card = await prisma.card.findUniqueOrThrow({ where: { id: cardA.id } });
    expect(card.listId).toBe(listA.id);
  });

  it("an EDITOR moves cards between lists of their board", async () => {
    const { editor, listB2, cardB } = await scenario();
    await loginAs(editor.id);

    const result = await moveCard({ cardId: cardB.id, toListId: listB2.id, position: "a5" });

    expect(result).toEqual({ ok: true });
    const card = await prisma.card.findUniqueOrThrow({ where: { id: cardB.id } });
    expect(card.listId).toBe(listB2.id);
  });

  it("a VIEWER cannot move", async () => {
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

  it("a non-member is redirected to /boards", async () => {
    const { listB2, cardB, listB1 } = await scenario();
    const stranger = await seedUser();
    await loginAs(stranger.id);

    await expect(
      moveCard({ cardId: cardB.id, toListId: listB2.id, position: "a5" }),
    ).rejects.toMatchObject({ digest: expect.stringContaining(";/boards;") });
    const card = await prisma.card.findUniqueOrThrow({ where: { id: cardB.id } });
    expect(card.listId).toBe(listB1.id);
  });

  it("without a session they are redirected to /login", async () => {
    const { listB2, cardB } = await scenario();
    await expect(
      moveCard({ cardId: cardB.id, toListId: listB2.id, position: "a5" }),
    ).rejects.toMatchObject({ digest: expect.stringContaining(";/login;") });
  });
});
