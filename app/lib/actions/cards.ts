"use server";

import { prisma } from "@/app/lib/prisma";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { requireBoardAccess } from "@/app/lib/dal";
import { canEditBoard } from "@/app/lib/roles";
import { z } from "zod";
import {
  cardTitleSchema,
  cardDetailsSchema,
  dueDateSchema,
} from "@/app/lib/validators";
import { cardBelongsToBoard, createCardAtEnd } from "@/app/lib/services/cards";
import { isValidPositionKey } from "@/app/lib/ordering";

const setCardDueDateSchema = z.object({
  cardId: z.string().min(1),
  dueDate: dueDateSchema,
});

// La posición llega del cliente (drag & drop): se valida antes de cualquier consulta,
// porque una clave inválida guardada haría fallar para siempre las altas en esa lista.
const moveCardSchema = z.object({
  cardId: z.string().min(1),
  toListId: z.string().min(1),
  position: z.string().refine(isValidPositionKey),
});

/** "YYYY-MM-DD" → medianoche UTC (fecha de calendario); vacío o null → sin fecha. */
function toDueDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

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

  await createCardAtEnd({ listId, title: parsed.data });
  revalidateBoard(boardId);
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

  // Si algo no valida no se guarda NADA (ni la descripción): guardar solo una parte
  // perdería en silencio lo que el usuario escribió en la otra.
  const parsed = cardDetailsSchema.safeParse({
    description: String(formData.get("description") ?? ""),
    dueDate: String(formData.get("dueDate") ?? "").trim(),
  });
  if (!parsed.success) return;

  await prisma.card.update({
    where: { id: cardId },
    data: {
      description: parsed.data.description || null,
      dueDate: toDueDate(parsed.data.dueDate),
    },
  });
  revalidateBoard(card.list.boardId);
}

/**
 * Cambia SOLO la fecha de vencimiento (sin tocar la descripción). La usa el arrastre en
 * la vista de calendario (Hito 11). `dueDate` es "YYYY-MM-DD" o null para quitarla.
 */
export async function setCardDueDate(input: {
  cardId: string;
  dueDate: string | null;
}): Promise<{ ok: boolean }> {
  const parsed = setCardDueDateSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const { cardId, dueDate } = parsed.data;
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { list: { select: { boardId: true } } },
  });
  if (!card) return { ok: false };
  const { role } = await requireBoardAccess(card.list.boardId);
  if (!canEditBoard(role)) return { ok: false };

  await prisma.card.update({
    where: { id: cardId },
    data: { dueDate: toDueDate(dueDate) },
  });
  revalidateBoard(card.list.boardId);
  return { ok: true };
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
  revalidateBoard(card.list.boardId);
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
  revalidateBoard(card.list.boardId);
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
  const parsed = moveCardSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const { cardId, toListId, position } = parsed.data;
  const boardId = await boardIdForList(toListId);
  if (!boardId) return { ok: false };
  const { role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return { ok: false };

  // Seguridad (IDOR): la tarjeta debe pertenecer YA al MISMO tablero de destino. Sin esta
  // comprobación, un editor podría mover a su tablero una tarjeta de OTRO tablero al que no
  // tiene acceso, conociendo solo su id. No se mueven tarjetas entre tableros (la UI tampoco
  // lo permite: el arrastre es dentro de un único tablero).
  if (!(await cardBelongsToBoard(cardId, boardId))) return { ok: false };

  await prisma.card.update({
    where: { id: cardId },
    data: { listId: toListId, position },
  });
  revalidateBoard(boardId);
  return { ok: true };
}
