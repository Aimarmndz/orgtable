"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/app/lib/prisma";
import { requireBoardAccess } from "@/app/lib/dal";
import { canEditBoard, canManageBoard } from "@/app/lib/roles";
import { LABEL_COLORS } from "@/app/lib/colors";

async function boardIdForCard(cardId: string): Promise<string | null> {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { list: { select: { boardId: true } } },
  });
  return card?.list.boardId ?? null;
}

export async function createLabel(formData: FormData): Promise<void> {
  const boardId = String(formData.get("boardId"));
  const { role } = await requireBoardAccess(boardId);
  if (!canManageBoard(role)) return;
  const name = String(formData.get("name") ?? "").trim().slice(0, 40);
  const colorRaw = String(formData.get("color") ?? "blue");
  if (!name) return;
  const color = colorRaw in LABEL_COLORS ? colorRaw : "blue";

  await prisma.label.create({ data: { boardId, name, color } });
  revalidatePath(`/board/${boardId}`);
}

export async function deleteLabel(formData: FormData): Promise<void> {
  const labelId = String(formData.get("labelId"));
  const label = await prisma.label.findUnique({
    where: { id: labelId },
    select: { boardId: true },
  });
  if (!label) return;
  const { role } = await requireBoardAccess(label.boardId);
  if (!canManageBoard(role)) return;

  await prisma.label.delete({ where: { id: labelId } });
  revalidatePath(`/board/${label.boardId}`);
}

/** Asigna o quita una etiqueta a una tarjeta (toggle). */
export async function toggleCardLabel(input: {
  cardId: string;
  labelId: string;
}): Promise<{ ok: boolean }> {
  const boardId = await boardIdForCard(input.cardId);
  if (!boardId) return { ok: false };
  const { role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return { ok: false };

  const key = {
    cardId_labelId: { cardId: input.cardId, labelId: input.labelId },
  };
  const existing = await prisma.cardLabel.findUnique({ where: key });
  if (existing) {
    await prisma.cardLabel.delete({ where: key });
  } else {
    await prisma.cardLabel.create({
      data: { cardId: input.cardId, labelId: input.labelId },
    });
  }
  revalidatePath(`/board/${boardId}`);
  return { ok: true };
}
