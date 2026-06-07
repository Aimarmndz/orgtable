"use server";

import { prisma } from "@/app/lib/prisma";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { requireBoardAccess } from "@/app/lib/dal";
import { canEditBoard, canManageBoard } from "@/app/lib/roles";
import { cardContext } from "@/app/lib/services/cards";
import { commentTextSchema } from "@/app/lib/validators";
import { notify } from "@/app/lib/notifications";

// Comentarios de tarjeta (Hito 10). Comentar requiere permiso de edición (los lectores
// no comentan). Borrar lo puede hacer el autor o el propietario del tablero. Ver
// docs/card-collaboration.md.

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

  // Avisa a los asignados de la tarjeta (menos al propio autor).
  const assignees = await prisma.cardAssignee.findMany({
    where: { cardId },
    select: { userId: true },
  });
  await Promise.all(
    assignees
      .filter((a) => a.userId !== user.id)
      .map((a) =>
        notify({
          userId: a.userId,
          type: "comment.added",
          title: `Nuevo comentario en «${ctx.cardTitle}»`,
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
  // Solo el autor o el propietario del tablero.
  if (comment.authorId !== user.id && !canManageBoard(role)) return;

  await prisma.comment.delete({ where: { id: commentId } });
  revalidateBoard(boardId);
}
