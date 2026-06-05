"use server";

import { prisma } from "@/app/lib/prisma";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { requireBoardAccess } from "@/app/lib/dal";
import { canEditBoard } from "@/app/lib/roles";
import { positionAtEnd } from "@/app/lib/ordering";

async function boardIdForCard(cardId: string): Promise<string | null> {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { list: { select: { boardId: true } } },
  });
  return card?.list.boardId ?? null;
}

async function boardIdForChecklist(checklistId: string): Promise<string | null> {
  const cl = await prisma.checklist.findUnique({
    where: { id: checklistId },
    select: { card: { select: { list: { select: { boardId: true } } } } },
  });
  return cl?.card.list.boardId ?? null;
}

async function boardIdForItem(itemId: string): Promise<string | null> {
  const item = await prisma.checklistItem.findUnique({
    where: { id: itemId },
    select: {
      checklist: {
        select: { card: { select: { list: { select: { boardId: true } } } } },
      },
    },
  });
  return item?.checklist.card.list.boardId ?? null;
}

export async function createChecklist(formData: FormData): Promise<void> {
  const cardId = String(formData.get("cardId"));
  const boardId = await boardIdForCard(cardId);
  if (!boardId) return;
  const { role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return;
  const title =
    String(formData.get("title") ?? "").trim().slice(0, 80) || "Checklist";

  const last = await prisma.checklist.findFirst({
    where: { cardId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  await prisma.checklist.create({
    data: { cardId, title, position: positionAtEnd(last?.position ?? null) },
  });
  revalidateBoard(boardId);
}

export async function deleteChecklist(formData: FormData): Promise<void> {
  const checklistId = String(formData.get("checklistId"));
  const boardId = await boardIdForChecklist(checklistId);
  if (!boardId) return;
  const { role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return;

  await prisma.checklist.delete({ where: { id: checklistId } });
  revalidateBoard(boardId);
}

export async function addChecklistItem(formData: FormData): Promise<void> {
  const checklistId = String(formData.get("checklistId"));
  const boardId = await boardIdForChecklist(checklistId);
  if (!boardId) return;
  const { role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return;
  const text = String(formData.get("text") ?? "").trim().slice(0, 200);
  if (!text) return;

  const last = await prisma.checklistItem.findFirst({
    where: { checklistId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  await prisma.checklistItem.create({
    data: {
      checklistId,
      text,
      position: positionAtEnd(last?.position ?? null),
    },
  });
  revalidateBoard(boardId);
}

/** Marca/desmarca un ítem de checklist. */
export async function toggleChecklistItem(input: {
  itemId: string;
  done: boolean;
}): Promise<{ ok: boolean }> {
  const boardId = await boardIdForItem(input.itemId);
  if (!boardId) return { ok: false };
  const { role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return { ok: false };

  await prisma.checklistItem.update({
    where: { id: input.itemId },
    data: { done: input.done },
  });
  revalidateBoard(boardId);
  return { ok: true };
}

export async function deleteChecklistItem(formData: FormData): Promise<void> {
  const itemId = String(formData.get("itemId"));
  const boardId = await boardIdForItem(itemId);
  if (!boardId) return;
  const { role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return;

  await prisma.checklistItem.delete({ where: { id: itemId } });
  revalidateBoard(boardId);
}
