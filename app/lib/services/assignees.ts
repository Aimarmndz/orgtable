import "server-only";
import { prisma } from "@/app/lib/prisma";

// Invariante de negocio de la asignación (Hito 10): una tarjeta solo se puede asignar a
// alguien que YA es miembro del tablero. Aislado aquí para reutilizarlo desde la Server
// Action y poder testearlo directamente. NO autoriza al actor: eso lo hace la acción.

export type AssignResult = {
  assigned: boolean;
  reason?: "not_member" | "already";
};

export async function assignMemberToCard(
  boardId: string,
  cardId: string,
  userId: string,
): Promise<AssignResult> {
  const member = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId } },
    select: { userId: true },
  });
  if (!member) return { assigned: false, reason: "not_member" };

  const exists = await prisma.cardAssignee.findUnique({
    where: { cardId_userId: { cardId, userId } },
    select: { userId: true },
  });
  if (exists) return { assigned: false, reason: "already" };

  await prisma.cardAssignee.create({ data: { cardId, userId } });
  return { assigned: true };
}
