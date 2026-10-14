"use server";

import { prisma } from "@/app/lib/prisma";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { requireBoardAccess } from "@/app/lib/dal";
import { canEditBoard } from "@/app/lib/roles";
import { cardContext } from "@/app/lib/services/cards";
import { assignMemberToCard } from "@/app/lib/services/assignees";
import { notify, recipientI18n } from "@/app/lib/notifications";
import { fmt } from "@/app/i18n/format";

// Assign/unassign members on a card. Requires edit permission. Only people who ALREADY are
// board members can be assigned (the server checks it). See docs/card-collaboration.md and
// docs/authorization.md.

export async function assignMember(formData: FormData): Promise<void> {
  const cardId = String(formData.get("cardId"));
  const userId = String(formData.get("userId"));
  const ctx = await cardContext(cardId);
  if (!ctx) return;
  const { user, role } = await requireBoardAccess(ctx.boardId);
  if (!canEditBoard(role)) return;

  // The invariant (must be a member) + idempotency live in the testable service.
  const result = await assignMemberToCard(ctx.boardId, cardId, userId);
  if (!result.assigned) return;

  // Notify the assignee, in their language, unless they assigned themselves.
  if (userId !== user.id) {
    const { m } = await recipientI18n(userId);
    await notify({
      userId,
      type: "card.assigned",
      title: fmt(m.notifications.cardAssigned.title, { card: ctx.cardTitle }),
      body: fmt(m.notifications.cardAssigned.body, { board: ctx.boardTitle }),
      boardId: ctx.boardId,
      cardId,
    });
  }
  revalidateBoard(ctx.boardId);
}

export async function unassignMember(formData: FormData): Promise<void> {
  const cardId = String(formData.get("cardId"));
  const userId = String(formData.get("userId"));
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { list: { select: { boardId: true } } },
  });
  if (!card) return;
  const { role } = await requireBoardAccess(card.list.boardId);
  if (!canEditBoard(role)) return;

  await prisma.cardAssignee.deleteMany({ where: { cardId, userId } });
  revalidateBoard(card.list.boardId);
}
