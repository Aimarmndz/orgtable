import "server-only";
import { prisma } from "@/app/lib/prisma";
import { emitBoardEvent } from "@/app/lib/webhooks/dispatch";
import type { WebhookEvent } from "@/app/lib/webhooks/events";

// Small helpers the actions call after a change, so each one passes ids and not payloads.
// They never throw (emitBoardEvent swallows and logs), so an event can never undo a change.

export type CardSnapshot = { id: string; title: string; boardId: string; list: { id: string; title: string } };

/** A card as the payload shows it. Read BEFORE deleting it. */
export async function cardSnapshot(cardId: string): Promise<CardSnapshot | null> {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { id: true, title: true, list: { select: { id: true, title: true, boardId: true } } },
  });
  return card ? { id: card.id, title: card.title, boardId: card.list.boardId, list: { id: card.list.id, title: card.list.title } } : null;
}

export async function emitCard(
  event: Extract<WebhookEvent, `card.${string}` | "comment.created">,
  card: CardSnapshot | null,
  actorId: string | null,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (!card) return;
  await emitBoardEvent({
    event,
    boardId: card.boardId,
    actorId,
    data: { card: { id: card.id, title: card.title, list: card.list.title }, list: card.list, ...extra },
  });
}

export async function emitList(
  event: "list.created" | "list.deleted",
  list: { id: string; title: string; boardId: string },
  actorId: string | null,
): Promise<void> {
  await emitBoardEvent({ event, boardId: list.boardId, actorId, data: { list: { id: list.id, title: list.title } } });
}
