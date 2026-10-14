import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { labelBelongsToBoard } from "@/app/lib/services/labels";
import { toggleCardLabel, createLabel } from "@/app/lib/actions/labels";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedList,
  seedCard,
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
