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
  CARD_DESCRIPTION_MAX,
} from "@/app/lib/validators";
import { cardBelongsToBoard, createCardAtEnd } from "@/app/lib/services/cards";
import { deleteCardWithAttachments } from "@/app/lib/services/attachments";
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

/**
 * Resultado de updateCard para useActionState. Si no se guarda, devuelve también lo que
 * envió el usuario: React resetea el formulario no controlado al acabar la acción y, sin
 * rehidratarlo con esto, el texto escrito se perdería.
 */
export type CardDetailsState = {
  error?: string;
  description?: string;
  dueDate?: string;
};

/** Actualiza la descripción y/o la fecha de vencimiento de una tarjeta (Hito 2). */
export async function updateCard(
  _prev: CardDetailsState,
  formData: FormData,
): Promise<CardDetailsState> {
  const cardId = String(formData.get("cardId"));
  // El navegador envía los saltos de línea del textarea como \r\n, pero su maxLength los
  // cuenta como un carácter: sin normalizar, una descripción que en la UI mide 5000
  // llegaría con más y se rechazaría.
  const description = normalizeNewlines(String(formData.get("description") ?? ""));
  const dueDate = String(formData.get("dueDate") ?? "").trim();
  const submitted = { description, dueDate };

  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { description: true, list: { select: { boardId: true } } },
  });
  if (!card) return { error: "La tarjeta ya no existe.", ...submitted };
  const { role } = await requireBoardAccess(card.list.boardId);
  if (!canEditBoard(role)) {
    return { error: "No tienes permiso para editar esta tarjeta.", ...submitted };
  }

  // Si algo no valida no se guarda NADA (ni la descripción): guardar solo una parte
  // perdería en silencio lo que el usuario escribió en la otra.
  const parsedDue = dueDateSchema.safeParse(dueDate);
  if (!parsedDue.success) {
    return { error: "La fecha de vencimiento no es válida.", ...submitted };
  }

  // Una descripción que no ha cambiado no se valida ni se reescribe: las anteriores al
  // límite pueden pasar de CARD_DESCRIPTION_MAX y, si no, ya no se podría cambiar el
  // vencimiento de esa tarjeta desde el modal (el formulario reenvía la descripción).
  const unchanged =
    description.trim() === normalizeNewlines(card.description ?? "").trim();
  let newDescription: { description: string | null } | undefined;
  if (!unchanged) {
    const parsedDescription = cardDetailsSchema.shape.description.safeParse(description);
    if (!parsedDescription.success) {
      return {
        error: `La descripción no puede superar ${CARD_DESCRIPTION_MAX} caracteres (tiene ${description.trim().length}).`,
        ...submitted,
      };
    }
    newDescription = { description: parsedDescription.data || null };
  }

  await prisma.card.update({
    where: { id: cardId },
    data: { ...newDescription, dueDate: toDueDate(parsedDue.data) },
  });
  revalidateBoard(card.list.boardId);
  return {};
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
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

  await deleteCardWithAttachments(cardId);
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
