import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { getBoardWithLists } from "@/app/lib/queries";
import { positionAtEnd } from "@/app/lib/ordering";
import { createChecklist, addChecklistItem } from "@/app/lib/actions/checklists";
import { POST as createList } from "@/app/api/v1/boards/[id]/lists/route";
import { POST as createCard } from "@/app/api/v1/lists/[id]/cards/route";
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

// Fractional indexing keys (base62: 0-9A-Za-z) are only correctly ordered byte by byte.
// 'Zz' is the key right before 'a0' (generated when dragging to the top), but with a
// linguistic collation (en_US.utf8 on glibc, the Debian postgres image the CI uses) it
// sorts AFTER 'a0l'. Migration 20260924000000_position_collate_c sets COLLATE "C" on the
// four columns.
//
// On postgres alpine (musl, the development DB) the order was already byte by byte, so
// the behaviour tests would only fail without the fix on glibc; the first test checks the
// columns' collation and fails on any server without it.

const KEYS = ["a0", "a0V", "a0l", "Zz"];
const EXPECTED_ORDER = ["Zz", "a0", "a0V", "a0l"];

// It also fails without dragging: appending generates a0…a9, aA…aZ and then 'aa', which a
// linguistic collation sorts BEFORE 'aB'…'aZ'. With 37 items (a0…aa) the "last" one by
// ORDER BY DESC would be 'aZ' and the 38th insert would repeat 'aa'.
function endKeys(count: number): string[] {
  const keys: string[] = [];
  let last: string | null = null;
  for (let i = 0; i < count; i++) {
    last = positionAtEnd(last);
    keys.push(last);
  }
  return keys;
}
const END_KEYS = endKeys(37);

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

describe("collation of the position keys (integration)", () => {
  it("the position columns use the C collation", async () => {
    const rows = await prisma.$queryRaw<
      { table_name: string; collation_name: string | null }[]
    >`SELECT table_name, collation_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'position'
      ORDER BY table_name`;
    expect(rows).toEqual([
      { table_name: "Card", collation_name: "C" },
      { table_name: "Checklist", collation_name: "C" },
      { table_name: "ChecklistItem", collation_name: "C" },
      { table_name: "List", collation_name: "C" },
    ]);
  });

  it("cards are sorted byte by byte and createCard does not repeat keys", async () => {
    const owner = await seedUser();
    const token = await seedApiToken(owner.id);
    const board = await seedBoard(owner.id);
    const list = await seedList(board.id);
    await prisma.card.createMany({
      data: KEYS.map((position) => ({ listId: list.id, title: position, position })),
    });

    const before = await getBoardWithLists(board.id, owner.id);
    expect(before?.lists[0]?.cards.map((c) => c.title)).toEqual(EXPECTED_ORDER);

    const res = await createCard(
      apiRequest("POST", `/api/v1/lists/${list.id}/cards`, {
        token,
        body: { title: "new" },
      }),
      ctx({ id: list.id }),
    );
    expect(res.status).toBe(201);

    const cards = await prisma.card.findMany({
      where: { listId: list.id },
      select: { title: true, position: true },
    });
    const created = cards.find((c) => c.title === "new");
    // JS string comparison = order by UTF-16 code units, the same as byte by byte in ASCII:
    // the new key must come after the actual largest one ('a0l').
    expect(created && created.position > "a0l").toBe(true);
    expect(new Set(cards.map((c) => c.position)).size).toBe(cards.length);

    const after = await getBoardWithLists(board.id, owner.id);
    expect(after?.lists[0]?.cards.map((c) => c.title)).toEqual([
      ...EXPECTED_ORDER,
      "new",
    ]);
  });

  it("lists are sorted byte by byte and createList does not repeat keys", async () => {
    const owner = await seedUser();
    const token = await seedApiToken(owner.id);
    const board = await seedBoard(owner.id);
    await prisma.list.createMany({
      data: KEYS.map((position) => ({ boardId: board.id, title: position, position })),
    });

    const before = await getBoardWithLists(board.id, owner.id);
    expect(before?.lists.map((l) => l.title)).toEqual(EXPECTED_ORDER);

    const res = await createList(
      apiRequest("POST", `/api/v1/boards/${board.id}/lists`, {
        token,
        body: { title: "new" },
      }),
      ctx({ id: board.id }),
    );
    expect(res.status).toBe(201);

    const lists = await prisma.list.findMany({
      where: { boardId: board.id },
      select: { title: true, position: true },
    });
    const created = lists.find((l) => l.title === "new");
    expect(created && created.position > "a0l").toBe(true);
    expect(new Set(lists.map((l) => l.position)).size).toBe(lists.length);

    const after = await getBoardWithLists(board.id, owner.id);
    expect(after?.lists.map((l) => l.title)).toEqual([...EXPECTED_ORDER, "new"]);
  });

  it("createChecklist and addChecklistItem do not repeat keys after 'aZ' → 'aa'", async () => {
    expect(END_KEYS.slice(-2)).toEqual(["aZ", "aa"]);
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    const list = await seedList(board.id);
    const card = await seedCard(list.id);
    // The checklist actions have no route in the public API: they are called with the board
    // owner's session.
    await loginAs(owner.id);
    await prisma.checklist.createMany({
      data: END_KEYS.map((position) => ({ cardId: card.id, title: position, position })),
    });

    const fd = new FormData();
    fd.set("cardId", card.id);
    fd.set("title", "new");
    await createChecklist(fd);

    const checklists = await prisma.checklist.findMany({
      where: { cardId: card.id },
      select: { id: true, title: true, position: true },
    });
    expect(checklists).toHaveLength(END_KEYS.length + 1);
    const created = checklists.find((c) => c.title === "new");
    expect(created && created.position > "aa").toBe(true);
    expect(new Set(checklists.map((c) => c.position)).size).toBe(checklists.length);

    const target = checklists.find((c) => c.title === "a0");
    if (!target) throw new Error("the seeded checklist 'a0' is missing");
    await prisma.checklistItem.createMany({
      data: END_KEYS.map((position) => ({
        checklistId: target.id,
        text: position,
        position,
      })),
    });
    const itemFd = new FormData();
    itemFd.set("checklistId", target.id);
    itemFd.set("text", "new item");
    await addChecklistItem(itemFd);

    const items = await prisma.checklistItem.findMany({
      where: { checklistId: target.id },
      select: { text: true, position: true },
    });
    expect(items).toHaveLength(END_KEYS.length + 1);
    const createdItem = items.find((i) => i.text === "new item");
    expect(createdItem && createdItem.position > "aa").toBe(true);
    expect(new Set(items.map((i) => i.position)).size).toBe(items.length);
  });
});
