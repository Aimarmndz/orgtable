"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/app/lib/prisma";
import { requireBoardAccess } from "@/app/lib/dal";
import { canEditBoard } from "@/app/lib/roles";
import { cardTitleSchema } from "@/app/lib/validators";
import { positionAtEnd } from "@/app/lib/ordering";

// Helper: dado un listId, devuelve el boardId al que pertenece (para autorizar y
// revalidar). Devuelve null si la lista no existe.
async function boardIdForList(listId: string): Promise<string | null> {
  const list = await prisma.list.findUnique({
    where: { id: listId },
    select: { boardId: true },
  });
  return list?.boardId ?? null;
}

export async function createCard(formData: FormData): Promise<void> {
  const listId = String(formData.get("listId"));
  const boardId = await boardIdForList(listId);
  if (!boardId) return;
  const { role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return;
  const parsed = cardTitleSchema.safeParse(formData.get("title"));
  if (!parsed.success) return;

  const last = await prisma.card.findFirst({
    where: { listId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  await prisma.card.create({
    data: {
      listId,
      title: parsed.data,
      position: positionAtEnd(last?.position ?? null),
    },
  });
  revalidatePath(`/board/${boardId}`);
}

/** Actualiza la descripción y/o la fecha de vencimiento de una tarjeta (Hito 2). */
export async function updateCard(formData: FormData): Promise<void> {
  const cardId = String(formData.get("cardId"));
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { list: { select: { boardId: true } } },
  });
  if (!card) return;
  const { role } = await requireBoardAccess(card.list.boardId);
  if (!canEditBoard(role)) return;

  const description = String(formData.get("description") ?? "").trim();
  const dueRaw = String(formData.get("dueDate") ?? "").trim();
  const due = dueRaw ? new Date(dueRaw) : null;

  await prisma.card.update({
    where: { id: cardId },
    data: {
      description: description || null,
      dueDate: due && !Number.isNaN(due.getTime()) ? due : null,
    },
  });
  revalidatePath(`/board/${card.list.boardId}`);
}

export async function renameCard(formData: FormData): Promise<void> {
  const cardId = String(formData.get("cardId"));
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { list: { select: { boardId: true } } },
  });
  if (!card) return;
  const { role } = await requireBoardAccess(card.list.boardId);
  if (!canEditBoard(role)) return;
  const parsed = cardTitleSchema.safeParse(formData.get("title"));
  if (!parsed.success) return;

  await prisma.card.update({ where: { id: cardId }, data: { title: parsed.data } });
  revalidatePath(`/board/${card.list.boardId}`);
}

export async function deleteCard(formData: FormData): Promise<void> {
  const cardId = String(formData.get("cardId"));
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { list: { select: { boardId: true } } },
  });
  if (!card) return;
  const { role } = await requireBoardAccess(card.list.boardId);
  if (!canEditBoard(role)) return;

  await prisma.card.delete({ where: { id: cardId } });
  revalidatePath(`/board/${card.list.boardId}`);
}

/**
 * Persiste el movimiento de una tarjeta tras drag & drop: puede cambiar de lista y/o
 * de posición. El cliente calcula la nueva clave de posición (fractional indexing).
 * Un único UPDATE de la fila movida.
 */
export async function moveCard(input: {
  cardId: string;
  toListId: string;
  position: string;
}): Promise<{ ok: boolean }> {
  const boardId = await boardIdForList(input.toListId);
  if (!boardId) return { ok: false };
  const { role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return { ok: false };

  await prisma.card.update({
    where: { id: input.cardId },
    data: { listId: input.toListId, position: input.position },
  });
  revalidatePath(`/board/${boardId}`);
  return { ok: true };
}
