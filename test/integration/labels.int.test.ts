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
    data: { boardId: boardA.id, name: "Urgente", color: "red" },
  });
  const labelB = await prisma.label.create({
    data: { boardId: boardB.id, name: "Secreto de B", color: "green" },
  });
  return { owner, boardA, boardB, cardA, labelA, labelB };
}

describe("etiquetas: pertenencia al tablero (IDOR de toggleCardLabel)", () => {
  it("labelBelongsToBoard solo es true para el tablero real de la etiqueta", async () => {
    const { boardA, boardB, labelB } = await seedTwoBoards();
    expect(await labelBelongsToBoard(labelB.id, boardB.id)).toBe(true);
    expect(await labelBelongsToBoard(labelB.id, boardA.id)).toBe(false);
    expect(await labelBelongsToBoard("cminexistente000000000000", boardA.id)).toBe(false);
  });

  it("toggleCardLabel rechaza una etiqueta de otro tablero y no crea el vínculo", async () => {
    const { owner, cardA, labelB } = await seedTwoBoards();
    await loginAs(owner.id);

    const res = await toggleCardLabel({ cardId: cardA.id, labelId: labelB.id });
    expect(res).toEqual({ ok: false });
    expect(await prisma.cardLabel.count()).toBe(0);
  });

  it("toggleCardLabel rechaza un id inexistente sin lanzar", async () => {
    const { owner, cardA } = await seedTwoBoards();
    await loginAs(owner.id);

    const res = await toggleCardLabel({ cardId: cardA.id, labelId: "no-existe" });
    expect(res).toEqual({ ok: false });
    expect(await prisma.cardLabel.count()).toBe(0);
  });

  it("toggleCardLabel pone y quita una etiqueta del mismo tablero", async () => {
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

describe("etiquetas: color validado contra la paleta", () => {
  it("createLabel guarda 'blue' si el color es una clave del prototipo", async () => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    await loginAs(owner.id);

    const fd = new FormData();
    fd.set("boardId", board.id);
    fd.set("name", "Rara");
    fd.set("color", "constructor");
    await createLabel(fd);

    const label = await prisma.label.findFirstOrThrow({ where: { boardId: board.id } });
    expect(label.color).toBe("blue");
  });

  it("createLabel conserva un color válido de la paleta", async () => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    await loginAs(owner.id);

    const fd = new FormData();
    fd.set("boardId", board.id);
    fd.set("name", "Bien");
    fd.set("color", "teal");
    await createLabel(fd);

    const label = await prisma.label.findFirstOrThrow({ where: { boardId: board.id } });
    expect(label.color).toBe("teal");
  });
});
