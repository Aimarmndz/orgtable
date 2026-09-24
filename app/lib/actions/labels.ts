"use server";

import { prisma } from "@/app/lib/prisma";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { requireBoardAccess } from "@/app/lib/dal";
import { canEditBoard, canManageBoard } from "@/app/lib/roles";
import { z } from "zod";
import { labelColorSchema } from "@/app/lib/validators";
import { labelBelongsToBoard } from "@/app/lib/services/labels";

const toggleCardLabelSchema = z.object({
  cardId: z.string().min(1),
  labelId: z.string().min(1),
});

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
  if (!name) return;
  // Un color fuera de la paleta (incluidas claves del prototipo) se guarda como "blue".
  const color = labelColorSchema.parse(formData.get("color") ?? undefined);

  await prisma.label.create({ data: { boardId, name, color } });
  revalidateBoard(boardId);
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
  revalidateBoard(label.boardId);
}

/** Asigna o quita una etiqueta a una tarjeta (toggle). */
export async function toggleCardLabel(input: {
  cardId: string;
  labelId: string;
}): Promise<{ ok: boolean }> {
  const parsed = toggleCardLabelSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const { cardId, labelId } = parsed.data;
  const boardId = await boardIdForCard(cardId);
  if (!boardId) return { ok: false };
  const { role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return { ok: false };
  // Seguridad (IDOR): la etiqueta debe ser del MISMO tablero que la tarjeta. Ver
  // labelBelongsToBoard.
  if (!(await labelBelongsToBoard(labelId, boardId))) return { ok: false };

  const key = { cardId_labelId: { cardId, labelId } };
  const existing = await prisma.cardLabel.findUnique({ where: key });
  if (existing) {
    await prisma.cardLabel.delete({ where: key });
  } else {
    await prisma.cardLabel.create({ data: { cardId, labelId } });
  }
  revalidateBoard(boardId);
  return { ok: true };
}
