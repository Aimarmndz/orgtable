import "server-only";
import { prisma } from "@/app/lib/prisma";
import { positionAtEnd, positionsAtEnd } from "@/app/lib/ordering";

/**
 * Creates a list at the end of the board. Locks the board row (`FOR UPDATE`) so two
 * concurrent creates do not read the same last position and store the same key.
 * Same reasoning as createCardAtEnd (app/lib/services/cards.ts).
 */
export async function createListAtEnd(data: {
  boardId: string;
  title: string;
}): Promise<{ id: string; title: string; position: string }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Board" WHERE id = ${data.boardId} FOR UPDATE`;
    const last = await tx.list.findFirst({
      where: { boardId: data.boardId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    return tx.list.create({
      data: {
        boardId: data.boardId,
        title: data.title,
        position: positionAtEnd(last?.position ?? null),
      },
      select: { id: true, title: true, position: true },
    });
  });
}

/**
 * Re-sorts a list's cards by due date: soonest first, cards without a date last, ties in
 * their current order. Every card gets a fresh key, so the list ends up with short keys.
 */
export async function sortListByDueDate(listId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "List" WHERE id = ${listId} FOR UPDATE`;
    const cards = await tx.card.findMany({
      where: { listId },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { position: "asc" }],
      select: { id: true },
    });
    const keys = positionsAtEnd(null, cards.length);
    for (const [i, card] of cards.entries()) {
      await tx.card.update({ where: { id: card.id }, data: { position: keys[i] } });
    }
  });
}

/**
 * Moves every card of one list to the end of another list of the SAME board, keeping
 * their order. Both rows are locked in id order (no deadlock with a move the other way).
 * Returns the ids moved, for the webhooks. The caller checks both lists share a board.
 */
export async function moveAllCards(fromListId: string, toListId: string): Promise<string[]> {
  if (fromListId === toListId) return [];
  return prisma.$transaction(async (tx) => {
    const [first, second] = [fromListId, toListId].sort();
    await tx.$queryRaw`SELECT 1 FROM "List" WHERE id = ${first} FOR UPDATE`;
    await tx.$queryRaw`SELECT 1 FROM "List" WHERE id = ${second} FOR UPDATE`;
    const cards = await tx.card.findMany({
      where: { listId: fromListId },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    if (cards.length === 0) return [];
    const last = await tx.card.findFirst({
      where: { listId: toListId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const keys = positionsAtEnd(last?.position ?? null, cards.length);
    for (const [i, card] of cards.entries()) {
      await tx.card.update({ where: { id: card.id }, data: { listId: toListId, position: keys[i] } });
    }
    return cards.map((c) => c.id);
  });
}
