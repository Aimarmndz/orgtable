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
import { cardBelongsToBoard, createCardAtEnd, duplicateCardBelow } from "@/app/lib/services/cards";
import { deleteCardWithAttachments } from "@/app/lib/services/attachments";
import { isValidPositionKey } from "@/app/lib/ordering";
import { getI18n } from "@/app/i18n/server";
import { cardSnapshot, emitCard } from "@/app/lib/webhooks/emit";
import { fmt } from "@/app/i18n/format";

const setCardDueDateSchema = z.object({
  cardId: z.string().min(1),
  dueDate: dueDateSchema,
});

// The position comes from the client (drag & drop): it is validated before any query,
// because an invalid key once stored would make every new card in that list fail forever.
const moveCardSchema = z.object({
  cardId: z.string().min(1),
  toListId: z.string().min(1),
  position: z.string().refine(isValidPositionKey),
});

/** "YYYY-MM-DD" → midnight UTC (calendar date); empty or null → no date. */
function toDueDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

// Given a listId, returns the boardId it belongs to (to authorise and revalidate). Returns
// null if the list does not exist.
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
  const { user, role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return;
  const parsed = cardTitleSchema.safeParse(formData.get("title"));
  if (!parsed.success) return;

  const card = await createCardAtEnd({ listId, title: parsed.data });
  revalidateBoard(boardId);
  await emitCard("card.created", await cardSnapshot(card.id), user.id);
}

/**
 * Result of updateCard for useActionState. When nothing is saved, it also returns what the
 * user sent: React resets the uncontrolled form when the action ends and, without
 * rehydrating it with this, the typed text would be lost.
 */
export type CardDetailsState = {
  error?: string;
  description?: string;
  dueDate?: string;
};

/** Updates a card's description and/or due date. */
export async function updateCard(
  _prev: CardDetailsState,
  formData: FormData,
): Promise<CardDetailsState> {
  const { m } = await getI18n();
  const cardId = String(formData.get("cardId"));
  // The browser sends the textarea's line breaks as \r\n, but its maxLength counts them as
  // one character: without normalising, a description that measures 5000 in the UI would
  // arrive longer and be rejected.
  const description = normalizeNewlines(String(formData.get("description") ?? ""));
  const dueDate = String(formData.get("dueDate") ?? "").trim();
  const submitted = { description, dueDate };

  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { description: true, list: { select: { boardId: true } } },
  });
  if (!card) return { error: m.errors.cards.notFound, ...submitted };
  const { user, role } = await requireBoardAccess(card.list.boardId);
  if (!canEditBoard(role)) {
    return { error: m.errors.cards.noPermission, ...submitted };
  }

  // If anything fails validation NOTHING is saved (not even the description): saving only
  // one part would silently lose what the user wrote in the other.
  const parsedDue = dueDateSchema.safeParse(dueDate);
  if (!parsedDue.success) {
    return { error: m.errors.cards.invalidDueDate, ...submitted };
  }

  // An unchanged description is neither validated nor rewritten: those older than the limit
  // may exceed CARD_DESCRIPTION_MAX and, otherwise, that card's due date could no longer be
  // changed from the modal (the form resends the description).
  const unchanged =
    description.trim() === normalizeNewlines(card.description ?? "").trim();
  let newDescription: { description: string | null } | undefined;
  if (!unchanged) {
    const parsedDescription = cardDetailsSchema.shape.description.safeParse(description);
    if (!parsedDescription.success) {
      return {
        error: fmt(m.errors.cards.descriptionTooLong, {
          max: CARD_DESCRIPTION_MAX,
          length: description.trim().length,
        }),
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
  await emitCard("card.updated", await cardSnapshot(cardId), user.id, {
    changes: [...(newDescription ? ["description"] : []), "dueDate"],
  });
  return {};
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/**
 * Changes ONLY the due date (without touching the description). Used by dragging in the
 * calendar view. `dueDate` is "YYYY-MM-DD", or null to clear it.
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
  const { user, role } = await requireBoardAccess(card.list.boardId);
  if (!canEditBoard(role)) return { ok: false };

  await prisma.card.update({
    where: { id: cardId },
    data: { dueDate: toDueDate(dueDate) },
  });
  revalidateBoard(card.list.boardId);
  await emitCard("card.updated", await cardSnapshot(cardId), user.id, { changes: ["dueDate"] });
  return { ok: true };
}

export async function renameCard(formData: FormData): Promise<void> {
  const cardId = String(formData.get("cardId"));
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { list: { select: { boardId: true } } },
  });
  if (!card) return;
  const { user, role } = await requireBoardAccess(card.list.boardId);
  if (!canEditBoard(role)) return;
  const parsed = cardTitleSchema.safeParse(formData.get("title"));
  if (!parsed.success) return;

  await prisma.card.update({ where: { id: cardId }, data: { title: parsed.data } });
  revalidateBoard(card.list.boardId);
  await emitCard("card.updated", await cardSnapshot(cardId), user.id, { changes: ["title"] });
}

export async function deleteCard(formData: FormData): Promise<void> {
  const cardId = String(formData.get("cardId"));
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { list: { select: { boardId: true } } },
  });
  if (!card) return;
  const { user, role } = await requireBoardAccess(card.list.boardId);
  if (!canEditBoard(role)) return;

  const before = await cardSnapshot(cardId);
  await deleteCardWithAttachments(cardId);
  revalidateBoard(card.list.boardId);
  await emitCard("card.deleted", before, user.id);
}

/**
 * Copies a card right below itself (board menu → Duplicate). The copy is titled
 * "<title> (copy)" in the actor's language, cut to the title limit. See duplicateCardBelow
 * for what travels with it.
 */
export async function duplicateCard(input: { cardId: string }): Promise<{ ok: boolean; id?: string }> {
  const cardId = String(input.cardId);
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { title: true, list: { select: { boardId: true } } },
  });
  if (!card) return { ok: false };
  const { user, role } = await requireBoardAccess(card.list.boardId);
  if (!canEditBoard(role)) return { ok: false };

  const { m } = await getI18n();
  const title = fmt(m.boards.menu.copyTitle, { title: card.title }).slice(0, 500);
  const copy = await duplicateCardBelow(cardId, title);
  if (!copy) return { ok: false };
  revalidateBoard(card.list.boardId);
  await emitCard("card.created", await cardSnapshot(copy.id), user.id);
  return { ok: true, id: copy.id };
}

/**
 * Persists a card move after drag & drop: it may change list and/or position. The client
 * computes the new position key (fractional indexing). A single UPDATE of the moved row.
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
  const { user, role } = await requireBoardAccess(boardId);
  if (!canEditBoard(role)) return { ok: false };

  // Security (IDOR): the card must ALREADY belong to the SAME destination board. Without
  // this check, an editor could move into their board a card from ANOTHER board they have
  // no access to, knowing only its id. Cards are not moved between boards (the UI does not
  // allow it either: dragging happens within a single board).
  if (!(await cardBelongsToBoard(cardId, boardId))) return { ok: false };

  const before = await cardSnapshot(cardId);
  await prisma.card.update({
    where: { id: cardId },
    data: { listId: toListId, position },
  });
  revalidateBoard(boardId);
  // Only a change of list is an event; reordering within a list is not worth a message.
  if (before && before.list.id !== toListId) {
    const after = await cardSnapshot(cardId);
    await emitCard("card.moved", after, user.id, { from: before.list, to: after?.list });
  }
  return { ok: true };
}
