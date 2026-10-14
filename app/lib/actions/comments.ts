"use server";

import { prisma } from "@/app/lib/prisma";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { requireBoardAccess } from "@/app/lib/dal";
import { canEditBoard, canManageBoard } from "@/app/lib/roles";
import { cardContext } from "@/app/lib/services/cards";
import { commentTextSchema } from "@/app/lib/validators";
import { notify } from "@/app/lib/notifications";
import { i18nFor } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";

// Card comments. Commenting requires edit permission (viewers do not comment). The author
// or the board owner can delete a comment. See docs/card-collaboration.md.

export async function addComment(formData: FormData): Promise<void> {
  const cardId = String(formData.get("cardId"));
  const ctx = await cardContext(cardId);
  if (!ctx) return;
  const { user, role } = await requireBoardAccess(ctx.boardId);
  if (!canEditBoard(role)) return;

  const parsed = commentTextSchema.safeParse(formData.get("text"));
  if (!parsed.success) return;

  await prisma.comment.create({
    data: { cardId, authorId: user.id, text: parsed.data },
  });

  // Notify the card's assignees (except the author) who are still board members, each in
  // their own language. Removing a member already deletes their assignments
  // (services/members.ts), but orphan rows from before that change may remain and must not
  // receive the comment's text.
  const assignees = await prisma.cardAssignee.findMany({
    where: {
      cardId,
      user: { memberships: { some: { boardId: ctx.boardId } } },
    },
    select: { userId: true, user: { select: { locale: true } } },
  });
  await Promise.all(
    assignees
      .filter((a) => a.userId !== user.id)
      .map((a) =>
        notify({
          userId: a.userId,
          type: "comment.added",
          title: fmt(i18nFor(a.user.locale).m.notifications.commentAdded.title, {
            card: ctx.cardTitle,
          }),
          body: parsed.data.slice(0, 140),
          boardId: ctx.boardId,
          cardId,
        }),
      ),
  );
  revalidateBoard(ctx.boardId);
}

export async function deleteComment(formData: FormData): Promise<void> {
  const commentId = String(formData.get("commentId"));
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      authorId: true,
      card: { select: { list: { select: { boardId: true } } } },
    },
  });
  if (!comment) return;
  const boardId = comment.card.list.boardId;
  const { user, role } = await requireBoardAccess(boardId);
  // Only the author or the board owner.
  if (comment.authorId !== user.id && !canManageBoard(role)) return;

  await prisma.comment.delete({ where: { id: commentId } });
  revalidateBoard(boardId);
}
