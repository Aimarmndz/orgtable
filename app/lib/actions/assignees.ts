"use server";

import { prisma } from "@/app/lib/prisma";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { requireBoardAccess } from "@/app/lib/dal";
import { canEditBoard } from "@/app/lib/roles";
import { cardContext } from "@/app/lib/services/cards";
import { assignMemberToCard } from "@/app/lib/services/assignees";
import { notify } from "@/app/lib/notifications";

// Asignar/quitar miembros de una tarjeta (Hito 10). Requiere permiso de edición. Solo se
// puede asignar a personas que YA son miembros del tablero (el servidor lo verifica). Ver
// docs/card-collaboration.md y docs/authorization.md.

export async function assignMember(formData: FormData): Promise<void> {
  const cardId = String(formData.get("cardId"));
  const userId = String(formData.get("userId"));
  const ctx = await cardContext(cardId);
  if (!ctx) return;
  const { user, role } = await requireBoardAccess(ctx.boardId);
  if (!canEditBoard(role)) return;

  // La invariante (debe ser miembro) + idempotencia viven en el servicio testeable.
  const result = await assignMemberToCard(ctx.boardId, cardId, userId);
  if (!result.assigned) return;

  // Notifica al asignado, salvo que se asigne a sí mismo.
  if (userId !== user.id) {
    await notify({
      userId,
      type: "card.assigned",
      title: `Te han asignado «${ctx.cardTitle}»`,
      body: `En el tablero «${ctx.boardTitle}».`,
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
