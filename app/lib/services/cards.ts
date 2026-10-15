import "server-only";
import { prisma } from "@/app/lib/prisma";
import { positionAtEnd, positionBetween } from "@/app/lib/ordering";

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

/**
 * Copies a card right below the original, in the same list: title (as given), description,
 * due date, labels and checklists with their items and ticks. Not copied: attachments
 * (their files belong to the original), comments and assignees (a copy is new work; the
 * people choose to take it). The list row is locked like in createCardAtEnd, so a
 * concurrent create or copy cannot take the same gap.
 */
export async function duplicateCardBelow(cardId: string, title: string): Promise<{ id: string } | null> {
  return prisma.$transaction(async (tx) => {
    const source = await tx.card.findUnique({
      where: { id: cardId },
      select: {
        listId: true,
        position: true,
        description: true,
        dueDate: true,
        labels: { select: { labelId: true } },
        checklists: {
          orderBy: { position: "asc" },
          select: {
            title: true,
            position: true,
            items: { orderBy: { position: "asc" }, select: { text: true, done: true, position: true } },
          },
        },
      },
    });
    if (!source) return null;
    await tx.$queryRaw`SELECT 1 FROM "List" WHERE id = ${source.listId} FOR UPDATE`;
    const next = await tx.card.findFirst({
      where: { listId: source.listId, position: { gt: source.position } },
      orderBy: { position: "asc" },
      select: { position: true },
    });
    const card = await tx.card.create({
      data: {
        listId: source.listId,
        title,
        description: source.description,
        dueDate: source.dueDate,
        position: positionBetween(source.position, next?.position ?? null),
        labels: { create: source.labels.map((l) => ({ labelId: l.labelId })) },
      },
      select: { id: true },
    });
    for (const checklist of source.checklists) {
      await tx.checklist.create({
        data: {
          cardId: card.id,
          title: checklist.title,
          position: checklist.position,
          items: { create: checklist.items },
        },
      });
    }
    return card;
  });
}
