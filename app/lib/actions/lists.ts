"use server";

import { prisma } from "@/app/lib/prisma";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { requireBoardAccess } from "@/app/lib/dal";
import { canEditBoard } from "@/app/lib/roles";
import { z } from "zod";
import { listTitleSchema } from "@/app/lib/validators";
import { isValidPositionKey } from "@/app/lib/ordering";
import { createListAtEnd } from "@/app/lib/services/lists";

// La posición llega del cliente: ver moveCardSchema en actions/cards.ts.
const reorderListSchema = z.object({
  listId: z.string().min(1),
  position: z.string().refine(isValidPositionKey),
});

export async function createList(formData: FormData): Promise<void> {
  const boardId = String(formData.get("boardId"));
  const { role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return;
  const parsed = listTitleSchema.safeParse(formData.get("title"));
  if (!parsed.success) return;

  await createListAtEnd({ boardId, title: parsed.data });
  revalidateBoard(boardId);
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
    select: { boardId: true },
  });
  if (!list) return;
  const { role } = await requireBoardAccess(list.boardId);
  if (!canEditBoard(role)) return;

  // Las tarjetas se borran en cascada (onDelete: Cascade en el esquema).
  await prisma.list.delete({ where: { id: listId } });
  revalidateBoard(list.boardId);
}

/**
 * Persiste el reordenamiento de una lista tras un drag & drop. El cliente calcula la
 * nueva clave de posición (fractional indexing) y la envía; aquí solo validamos el
 * acceso y actualizamos una única fila.
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
