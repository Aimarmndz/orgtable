"use server";

import { prisma } from "@/app/lib/prisma";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { cardSnapshot, emitCard, emitList } from "@/app/lib/webhooks/emit";
import { requireBoardAccess } from "@/app/lib/dal";
import { canEditBoard } from "@/app/lib/roles";
import { z } from "zod";
import { listTitleSchema } from "@/app/lib/validators";
import { isValidPositionKey } from "@/app/lib/ordering";
import { createListAtEnd, moveAllCards, sortListByDueDate } from "@/app/lib/services/lists";
import { deleteListWithAttachments } from "@/app/lib/services/attachments";

// The position comes from the client: see moveCardSchema in actions/cards.ts.
const reorderListSchema = z.object({
  listId: z.string().min(1),
  position: z.string().refine(isValidPositionKey),
});

export async function createList(formData: FormData): Promise<void> {
  const boardId = String(formData.get("boardId"));
  const { user, role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return;
  const parsed = listTitleSchema.safeParse(formData.get("title"));
  if (!parsed.success) return;

  const list = await createListAtEnd({ boardId, title: parsed.data });
  revalidateBoard(boardId);
  await emitList("list.created", { id: list.id, title: parsed.data, boardId }, user.id);
}

export async function renameList(formData: FormData): Promise<void> {
  const listId = String(formData.get("listId"));
  const list = await prisma.list.findUnique({
    where: { id: listId },
    select: { boardId: true },
  });
  if (!list) return;
  const { role } = await requireBoardAccess(list.boardId);
  if (!canEditBoard(role)) return;
  const parsed = listTitleSchema.safeParse(formData.get("title"));
  if (!parsed.success) return;

  await prisma.list.update({ where: { id: listId }, data: { title: parsed.data } });
  revalidateBoard(list.boardId);
}

export async function deleteList(formData: FormData): Promise<void> {
  const listId = String(formData.get("listId"));
  const list = await prisma.list.findUnique({
    where: { id: listId },
    select: { boardId: true, title: true },
  });
  if (!list) return;
  const { user, role } = await requireBoardAccess(list.boardId);
  if (!canEditBoard(role)) return;

  // Cards are deleted in cascade (onDelete: Cascade in the schema); the service deletes
  // their attachment files.
  await deleteListWithAttachments(listId);
  revalidateBoard(list.boardId);
  await emitList("list.deleted", { id: listId, title: list.title, boardId: list.boardId }, user.id);
}

/**
 * Persists a list reorder after drag & drop. The client computes the new position key
 * (fractional indexing) and sends it; here we only check access and update a single row.
 */
export async function reorderList(input: {
  listId: string;
  position: string;
}): Promise<{ ok: boolean }> {
  const parsed = reorderListSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const { listId, position } = parsed.data;
  const list = await prisma.list.findUnique({
    where: { id: listId },
    select: { boardId: true },
  });
  if (!list) return { ok: false };
  const { role } = await requireBoardAccess(list.boardId);
  if (!canEditBoard(role)) return { ok: false };

  await prisma.list.update({ where: { id: listId }, data: { position } });
  revalidateBoard(list.boardId);
  return { ok: true };
}

/** Board menu → Sort by due date: soonest first, undated last (editors). */
export async function sortListByDue(input: { listId: string }): Promise<{ ok: boolean }> {
  const listId = String(input.listId);
  const list = await prisma.list.findUnique({ where: { id: listId }, select: { boardId: true } });
  if (!list) return { ok: false };
  const { role } = await requireBoardAccess(list.boardId);
  if (!canEditBoard(role)) return { ok: false };
  await sortListByDueDate(listId);
  revalidateBoard(list.boardId);
  return { ok: true };
}

/**
 * Board menu → Move all cards to…: every card of a list to the end of another list.
 * Security (IDOR): both lists must be on the same board, the one the editor has access to.
 */
export async function moveAllCardsTo(input: {
  fromListId: string;
  toListId: string;
}): Promise<{ ok: boolean; moved?: number }> {
  const fromListId = String(input.fromListId);
  const toListId = String(input.toListId);
  const [from, to] = await Promise.all([
    prisma.list.findUnique({ where: { id: fromListId }, select: { boardId: true, id: true, title: true } }),
    prisma.list.findUnique({ where: { id: toListId }, select: { boardId: true, id: true, title: true } }),
  ]);
  if (!from || !to || from.boardId !== to.boardId) return { ok: false };
  const { user, role } = await requireBoardAccess(from.boardId);
  if (!canEditBoard(role)) return { ok: false };
  const moved = await moveAllCards(fromListId, toListId);
  revalidateBoard(from.boardId);
  for (const cardId of moved) {
    await emitCard("card.moved", await cardSnapshot(cardId), user.id, {
      from: { id: from.id, title: from.title },
      to: { id: to.id, title: to.title },
    });
  }
  return { ok: true, moved: moved.length };
}
