import "server-only";
import { prisma } from "@/app/lib/prisma";
import { positionAtEnd } from "@/app/lib/ordering";

// A card's context (its board) for authorization and notifications. Isolated here so the
// comment and assignee Server Actions can reuse it and so it can be tested. Returns null
// if the card does not exist.
export type CardContext = {
  cardId: string;
  cardTitle: string;
  boardId: string;
  boardTitle: string;
};

/**
 * Does the card belong to this board? moveCard uses it to prevent moving into your board a
 * card from ANOTHER board you have no access to (IDOR). Isolated here so it can be tested.
 */
export async function cardBelongsToBoard(
  cardId: string,
  boardId: string,
): Promise<boolean> {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { list: { select: { boardId: true } } },
  });
  return !!card && card.list.boardId === boardId;
}

export async function cardContext(
  cardId: string,
): Promise<CardContext | null> {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: {
      id: true,
      title: true,
      list: { select: { boardId: true, board: { select: { title: true } } } },
    },
  });
  if (!card) return null;
  return {
    cardId: card.id,
    cardTitle: card.title,
    boardId: card.list.boardId,
    boardTitle: card.list.board.title,
  };
}

/**
 * Creates a card at the end of the list. Reading the last position and creating are two
 * steps: without a lock, two concurrent creates (two users, or Promise.all against the
 * API) read the same last key and stored the SAME position, and then
 * generateKeyBetween(a, a) broke drag and drop in that list. `FOR UPDATE` on the list row
 * serializes creates within that list (other lists do not wait). There is no unique
 * index on (listId, position) because concurrent moves also collide and would fail.
 */
export async function createCardAtEnd(data: {
  listId: string;
  title: string;
  description?: string | null;
  dueDate?: Date | null;
}): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "List" WHERE id = ${data.listId} FOR UPDATE`;
    const last = await tx.card.findFirst({
      where: { listId: data.listId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    return tx.card.create({
      data: {
        listId: data.listId,
        title: data.title,
        description: data.description ?? null,
        dueDate: data.dueDate ?? null,
        position: positionAtEnd(last?.position ?? null),
      },
      select: { id: true },
    });
  });
}
