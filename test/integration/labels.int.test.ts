import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { labelBelongsToBoard } from "@/app/lib/services/labels";
import { toggleCardLabel, createLabel, updateLabel, deleteLabel } from "@/app/lib/actions/labels";
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

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

async function seedTwoBoards() {
  const owner = await seedUser();
  const boardA = await seedBoard(owner.id, "A");
  const boardB = await seedBoard(owner.id, "B");
  const cardA = await seedCard((await seedList(boardA.id)).id);
  const labelA = await prisma.label.create({
    data: { boardId: boardA.id, name: "Urgent", color: "red" },
  });
  const labelB = await prisma.label.create({
    data: { boardId: boardB.id, name: "B's secret", color: "green" },
  });
  return { owner, boardA, boardB, cardA, labelA, labelB };
}

describe("labels: board membership (toggleCardLabel IDOR)", () => {
  it("labelBelongsToBoard is only true for the label's actual board", async () => {
    const { boardA, boardB, labelB } = await seedTwoBoards();
    expect(await labelBelongsToBoard(labelB.id, boardB.id)).toBe(true);
    expect(await labelBelongsToBoard(labelB.id, boardA.id)).toBe(false);
    expect(await labelBelongsToBoard("cmmissing0000000000000000", boardA.id)).toBe(false);
  });

  it("toggleCardLabel rejects a label from another board and does not create the link", async () => {
    const { owner, cardA, labelB } = await seedTwoBoards();
    await loginAs(owner.id);

    const res = await toggleCardLabel({ cardId: cardA.id, labelId: labelB.id });
    expect(res).toEqual({ ok: false });
    expect(await prisma.cardLabel.count()).toBe(0);
  });

  it("toggleCardLabel rejects a missing id without throwing", async () => {
    const { owner, cardA } = await seedTwoBoards();
    await loginAs(owner.id);

    const res = await toggleCardLabel({ cardId: cardA.id, labelId: "does-not-exist" });
    expect(res).toEqual({ ok: false });
    expect(await prisma.cardLabel.count()).toBe(0);
  });

  it("toggleCardLabel adds and removes a label from the same board", async () => {
    const { owner, cardA, labelA } = await seedTwoBoards();
    await loginAs(owner.id);

    expect(await toggleCardLabel({ cardId: cardA.id, labelId: labelA.id })).toEqual({
      ok: true,
    });
    expect(await prisma.cardLabel.count()).toBe(1);
    expect(await toggleCardLabel({ cardId: cardA.id, labelId: labelA.id })).toEqual({
      ok: true,
    });
    expect(await prisma.cardLabel.count()).toBe(0);
  });
});

describe("labels: color validated against the palette", () => {
  it("createLabel stores 'blue' if the color is a prototype key", async () => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    await loginAs(owner.id);

    const fd = new FormData();
    fd.set("boardId", board.id);
    fd.set("name", "Odd");
    fd.set("color", "constructor");
    await createLabel(fd);

    const label = await prisma.label.findFirstOrThrow({ where: { boardId: board.id } });
    expect(label.color).toBe("blue");
  });

  it("createLabel keeps a valid palette color", async () => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    await loginAs(owner.id);

    const fd = new FormData();
    fd.set("boardId", board.id);
    fd.set("name", "Fine");
    fd.set("color", "teal");
    await createLabel(fd);

    const label = await prisma.label.findFirstOrThrow({ where: { boardId: board.id } });
    expect(label.color).toBe("teal");
  });
});

// Editing and deleting a label from the card or the board menu (docs/board-menu.md).
describe("labels: edit and delete", () => {
  async function scenario() {
    const { owner, boardA, cardA, labelA, labelB } = await seedTwoBoards();
    const editor = await seedUser();
    await addMember(boardA.id, editor.id, "EDITOR");
    await prisma.cardLabel.create({ data: { cardId: cardA.id, labelId: labelA.id } });
    return { owner, editor, boardA, cardA, labelA, labelB };
  }

  it("updateLabel lets the owner rename it and change its colour", async () => {
    const { owner, labelA } = await scenario();
    await loginAs(owner.id);

    expect(await updateLabel({ labelId: labelA.id, name: "  Blocked ", color: "amber" })).toEqual({ ok: true });
    const label = await prisma.label.findUniqueOrThrow({ where: { id: labelA.id } });
    expect(label).toMatchObject({ name: "Blocked", color: "amber" });
  });

  it("updateLabel refuses editors, empty names and colours outside the palette", async () => {
    const { owner, editor, labelA } = await scenario();
    await loginAs(editor.id);
    expect(await updateLabel({ labelId: labelA.id, name: "Mine", color: "red" })).toEqual({ ok: false });
    await loginAs(owner.id);
    expect(await updateLabel({ labelId: labelA.id, name: "   ", color: "red" })).toEqual({ ok: false });
    expect(await updateLabel({ labelId: labelA.id, name: "Odd", color: "constructor" })).toEqual({ ok: false });
    expect(await updateLabel({ labelId: labelA.id, name: "x".repeat(41), color: "red" })).toEqual({ ok: false });
    expect(await prisma.label.findUniqueOrThrow({ where: { id: labelA.id } })).toMatchObject({
      name: "Urgent",
      color: "red",
    });
  });

  it("deleteLabel removes it from the board and from its cards", async () => {
    const { owner, labelA, labelB } = await scenario();
    await loginAs(owner.id);

    expect(await deleteLabel({ labelId: labelA.id })).toEqual({ ok: true });
    expect(await prisma.label.findUnique({ where: { id: labelA.id } })).toBeNull();
    expect(await prisma.cardLabel.count()).toBe(0);
    // The other board's label is untouched.
    expect(await prisma.label.findUnique({ where: { id: labelB.id } })).not.toBeNull();
  });

  it("deleteLabel refuses editors and a missing id", async () => {
    const { owner, editor, labelA } = await scenario();
    await loginAs(editor.id);
    expect(await deleteLabel({ labelId: labelA.id })).toEqual({ ok: false });
    await loginAs(owner.id);
    expect(await deleteLabel({ labelId: "does-not-exist" })).toEqual({ ok: false });
    expect(await prisma.label.findUnique({ where: { id: labelA.id } })).not.toBeNull();
    expect(await prisma.cardLabel.count()).toBe(1);
  });
});
