import "server-only";
import { prisma } from "@/app/lib/prisma";

// Assignment business invariant: a card can only be assigned to someone who is ALREADY a
// member of the board. Isolated here so the Server Action can reuse it and it can be
// tested directly. It does NOT authorize the actor: the action does that.

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
