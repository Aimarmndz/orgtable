import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
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
} from "./helpers";

// Las acciones de checklist exigen sesión (cookies) y no tienen ruta en la API pública:
// se sustituye solo requireBoardAccess por un acceso de OWNER. El resto del DAL es real.
vi.mock("@/app/lib/dal", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/lib/dal")>();
  return {
    ...original,
    requireBoardAccess: async () => ({
      user: { id: "test-user" },
      role: "OWNER" as const,
    }),
  };
});

// Las claves de fractional indexing (base62: 0-9A-Za-z) solo están bien ordenadas byte a
// byte. 'Zz' es la clave inmediatamente anterior a 'a0' (se genera al arrastrar al
// principio), pero con una collation lingüística (en_US.utf8 sobre glibc, la imagen
// Debian de postgres que usa el CI) queda DESPUÉS de 'a0l'. La migración
// 20260924000000_position_collate_c fija COLLATE "C" en las cuatro columnas.
//
// En postgres alpine (musl, la BD de desarrollo) el orden ya era byte a byte, así que
// las pruebas de comportamiento solo fallarían sin el arreglo en glibc; la primera
// prueba comprueba la collation de las columnas y falla en cualquier servidor sin él.

const KEYS = ["a0", "a0V", "a0l", "Zz"];
const EXPECTED_ORDER = ["Zz", "a0", "a0V", "a0l"];

// También falla sin arrastrar: las altas al final generan a0…a9, aA…aZ y luego 'aa', que
// una collation lingüística ordena ANTES de 'aB'…'aZ'. Con 37 elementos (a0…aa) el
// «último» según ORDER BY DESC sería 'aZ' y el alta 38 repetiría 'aa'.
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

describe("collation de las claves de posición (integración)", () => {
  it("las columnas position usan la collation C", async () => {
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

  it("las tarjetas se ordenan byte a byte y createCard no repite claves", async () => {
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
        body: { title: "nueva" },
      }),
      ctx({ id: list.id }),
    );
    expect(res.status).toBe(201);

    const cards = await prisma.card.findMany({
      where: { listId: list.id },
      select: { title: true, position: true },
    });
    const created = cards.find((c) => c.title === "nueva");
    // Comparación de strings de JS = orden por unidades UTF-16, igual que byte a byte en
    // ASCII: la nueva clave debe ir detrás de la mayor real ('a0l').
    expect(created && created.position > "a0l").toBe(true);
    expect(new Set(cards.map((c) => c.position)).size).toBe(cards.length);

    const after = await getBoardWithLists(board.id, owner.id);
    expect(after?.lists[0]?.cards.map((c) => c.title)).toEqual([
      ...EXPECTED_ORDER,
      "nueva",
    ]);
  });

  it("las listas se ordenan byte a byte y createList no repite claves", async () => {
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
        body: { title: "nueva" },
      }),
      ctx({ id: board.id }),
    );
    expect(res.status).toBe(201);

    const lists = await prisma.list.findMany({
      where: { boardId: board.id },
      select: { title: true, position: true },
    });
    const created = lists.find((l) => l.title === "nueva");
    expect(created && created.position > "a0l").toBe(true);
    expect(new Set(lists.map((l) => l.position)).size).toBe(lists.length);

    const after = await getBoardWithLists(board.id, owner.id);
    expect(after?.lists.map((l) => l.title)).toEqual([...EXPECTED_ORDER, "nueva"]);
  });

  it("createChecklist y addChecklistItem no repiten claves tras 'aZ' → 'aa'", async () => {
    expect(END_KEYS.slice(-2)).toEqual(["aZ", "aa"]);
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    const list = await seedList(board.id);
    const card = await seedCard(list.id);
    await prisma.checklist.createMany({
      data: END_KEYS.map((position) => ({ cardId: card.id, title: position, position })),
    });

    const fd = new FormData();
    fd.set("cardId", card.id);
    fd.set("title", "nueva");
    await createChecklist(fd);

    const checklists = await prisma.checklist.findMany({
      where: { cardId: card.id },
      select: { id: true, title: true, position: true },
    });
    expect(checklists).toHaveLength(END_KEYS.length + 1);
    const created = checklists.find((c) => c.title === "nueva");
    expect(created && created.position > "aa").toBe(true);
    expect(new Set(checklists.map((c) => c.position)).size).toBe(checklists.length);

    const target = checklists.find((c) => c.title === "a0");
    if (!target) throw new Error("falta la checklist sembrada 'a0'");
    await prisma.checklistItem.createMany({
      data: END_KEYS.map((position) => ({
        checklistId: target.id,
        text: position,
        position,
      })),
    });
    const itemFd = new FormData();
    itemFd.set("checklistId", target.id);
    itemFd.set("text", "nuevo");
    await addChecklistItem(itemFd);

    const items = await prisma.checklistItem.findMany({
      where: { checklistId: target.id },
      select: { text: true, position: true },
    });
    expect(items).toHaveLength(END_KEYS.length + 1);
    const createdItem = items.find((i) => i.text === "nuevo");
    expect(createdItem && createdItem.position > "aa").toBe(true);
    expect(new Set(items.map((i) => i.position)).size).toBe(items.length);
  });
});
