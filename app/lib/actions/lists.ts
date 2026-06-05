"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/app/lib/prisma";
import { requireBoardAccess } from "@/app/lib/dal";
import { canEditBoard } from "@/app/lib/roles";
import { listTitleSchema } from "@/app/lib/validators";
import { positionAtEnd } from "@/app/lib/ordering";

export async function createList(formData: FormData): Promise<void> {
  const boardId = String(formData.get("boardId"));
  const { role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return;
  const parsed = listTitleSchema.safeParse(formData.get("title"));
  if (!parsed.success) return;

  const last = await prisma.list.findFirst({
    where: { boardId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  await prisma.list.create({
    data: {
      boardId,
      title: parsed.data,
      position: positionAtEnd(last?.position ?? null),
    },
  });
  revalidatePath(`/board/${boardId}`);
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
  revalidatePath(`/board/${list.boardId}`);
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
  revalidatePath(`/board/${list.boardId}`);
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
  const list = await prisma.list.findUnique({
    where: { id: input.listId },
    select: { boardId: true },
  });
  if (!list) return { ok: false };
  const { role } = await requireBoardAccess(list.boardId);
  if (!canEditBoard(role)) return { ok: false };

  await prisma.list.update({
    where: { id: input.listId },
    data: { position: input.position },
  });
  revalidatePath(`/board/${list.boardId}`);
  return { ok: true };
}
