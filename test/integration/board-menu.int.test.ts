import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { setBoardBackground } from "@/app/lib/actions/boards";
import { duplicateCard } from "@/app/lib/actions/cards";
import { moveAllCardsTo, sortListByDue } from "@/app/lib/actions/lists";
import { resetDb, disconnect, seedUser, seedBoard, seedList, seedCard, addMember, loginAs } from "./helpers";

// The Server Actions behind the board's context menu (app/components/board/board-menu.tsx)
// run for real with a session: who may use them and what they write. See
// docs/board-menu.md.

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

async function scenario() {
  const owner = await seedUser();
  const editor = await seedUser();
  const viewer = await seedUser();
  const board = await seedBoard(owner.id, "Menu");
  await addMember(board.id, editor.id, "EDITOR");
  await addMember(board.id, viewer.id, "VIEWER");
  const todo = await seedList(board.id, "To do");
  const done = await seedList(board.id, "Done");
  return { owner, editor, viewer, board, todo, done };
}

const cardsOf = (listId: string) =>
  prisma.card.findMany({ where: { listId }, orderBy: { position: "asc" }, select: { id: true, title: true } });

describe("setBoardBackground", () => {
  it("lets the owner pick a palette colour or go back to automatic", async () => {
    const { owner, board } = await scenario();
    await loginAs(owner.id);
    expect(await setBoardBackground({ boardId: board.id, background: "slate" })).toEqual({ ok: true });
    expect((await prisma.board.findUniqueOrThrow({ where: { id: board.id } })).background).toBe("slate");
    expect(await setBoardBackground({ boardId: board.id, background: null })).toEqual({ ok: true });
    expect((await prisma.board.findUniqueOrThrow({ where: { id: board.id } })).background).toBeNull();
  });

  it("refuses editors and colours outside the palette", async () => {
    const { owner, editor, board } = await scenario();
    await loginAs(editor.id);
    expect(await setBoardBackground({ boardId: board.id, background: "teal" })).toEqual({ ok: false });
    await loginAs(owner.id);
    expect(await setBoardBackground({ boardId: board.id, background: "url(javascript:x)" })).toEqual({ ok: false });
    expect(await setBoardBackground({ boardId: board.id, background: "constructor" })).toEqual({ ok: false });
    expect((await prisma.board.findUniqueOrThrow({ where: { id: board.id } })).background).toBeNull();
  });
});

describe("duplicateCard", () => {
  it("copies the card right below it, with labels, checklists and due date", async () => {
    const { editor, board, todo } = await scenario();
    const first = await seedCard(todo.id, "First");
    const last = await seedCard(todo.id, "Last");
    const label = await prisma.label.create({ data: { boardId: board.id, name: "Urgent", color: "red" } });
    await prisma.card.update({
      where: { id: first.id },
      data: {
        description: "Notes",
        dueDate: new Date("2026-11-02"),
        labels: { create: { labelId: label.id } },
        checklists: {
          create: { title: "Steps", position: "a0", items: { create: [{ text: "One", done: true, position: "a0" }, { text: "Two", position: "a1" }] } },
        },
        assignees: { create: { userId: editor.id } },
      },
    });
    await loginAs(editor.id);

    const result = await duplicateCard({ cardId: first.id });

    expect(result.ok).toBe(true);
    expect((await cardsOf(todo.id)).map((c) => c.title)).toEqual(["First", "First (copy)", "Last"]);
    const copy = await prisma.card.findUniqueOrThrow({
      where: { id: result.id! },
      include: { labels: true, assignees: true, checklists: { include: { items: { orderBy: { position: "asc" } } } } },
    });
    expect(copy).toMatchObject({ description: "Notes", dueDate: new Date("2026-11-02") });
    expect(copy.labels.map((l) => l.labelId)).toEqual([label.id]);
    expect(copy.checklists[0].items.map((i) => [i.text, i.done])).toEqual([["One", true], ["Two", false]]);
    // A copy is new work: nobody is assigned to it yet.
    expect(copy.assignees).toEqual([]);
    expect(last.id).not.toBe(copy.id);
  });

  it("is not for viewers", async () => {
    const { viewer, todo } = await scenario();
    const card = await seedCard(todo.id);
    await loginAs(viewer.id);
    expect(await duplicateCard({ cardId: card.id })).toEqual({ ok: false });
    expect(await prisma.card.count()).toBe(1);
  });
});

describe("sortListByDue", () => {
  it("puts the soonest first and undated cards last, keeping ties in order", async () => {
    const { editor, todo } = await scenario();
    const titles = ["none-1", "late", "soon", "none-2", "soon-too"];
    const dates: Record<string, string> = { late: "2026-12-01", soon: "2026-10-20", "soon-too": "2026-10-20" };
    for (const title of titles) {
      const card = await seedCard(todo.id, title);
      if (dates[title]) await prisma.card.update({ where: { id: card.id }, data: { dueDate: new Date(dates[title]) } });
    }
    await loginAs(editor.id);

    expect(await sortListByDue({ listId: todo.id })).toEqual({ ok: true });
    expect((await cardsOf(todo.id)).map((c) => c.title)).toEqual(["soon", "soon-too", "late", "none-1", "none-2"]);
  });

  it("is not for viewers", async () => {
    const { viewer, todo } = await scenario();
    await loginAs(viewer.id);
    expect(await sortListByDue({ listId: todo.id })).toEqual({ ok: false });
  });
});

describe("moveAllCardsTo", () => {
  it("moves every card, in order, to the end of the other list", async () => {
    const { editor, todo, done } = await scenario();
    await seedCard(done.id, "Already done");
    await seedCard(todo.id, "A");
    await seedCard(todo.id, "B");
    await loginAs(editor.id);

    expect(await moveAllCardsTo({ fromListId: todo.id, toListId: done.id })).toEqual({ ok: true, moved: 2 });
    expect(await cardsOf(todo.id)).toEqual([]);
    expect((await cardsOf(done.id)).map((c) => c.title)).toEqual(["Already done", "A", "B"]);
  });

  it("never moves cards into a list of another board (IDOR)", async () => {
    const { editor, todo } = await scenario();
    const stranger = await seedUser();
    const other = await seedBoard(stranger.id, "Other");
    const foreign = await seedList(other.id);
    await seedCard(todo.id, "Mine");
    await loginAs(editor.id);

    expect(await moveAllCardsTo({ fromListId: todo.id, toListId: foreign.id })).toEqual({ ok: false });
    expect(await prisma.card.count({ where: { listId: foreign.id } })).toBe(0);
  });

  it("is not for viewers", async () => {
    const { viewer, todo, done } = await scenario();
    await seedCard(todo.id);
    await loginAs(viewer.id);
    expect(await moveAllCardsTo({ fromListId: todo.id, toListId: done.id })).toEqual({ ok: false });
    expect(await prisma.card.count({ where: { listId: todo.id } })).toBe(1);
  });
});
