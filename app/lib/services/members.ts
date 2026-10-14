import "server-only";
import { prisma } from "@/app/lib/prisma";

// Removes a member from a board. Isolated from the Server Action so it can be tested
// without a session. It does NOT authorize the actor or protect the owner:
// removeBoardMember does that.
//
// Besides the BoardMember row, their assignments on the board's cards are deleted: if they
// remained, the removed user would keep receiving through the bell the card titles and
// comment text (comment.added, due.reminder) of a board they no longer have access to.
// Both run in one transaction so one half is never left behind.
//
// Returns how many memberships were deleted (0 if the user was not a member), so the
// action does not audit or notify a removal that did not happen.
export async function removeMemberFromBoard(
  boardId: string,
  userId: string,
): Promise<number> {
  const [removed] = await prisma.$transaction([
    prisma.boardMember.deleteMany({ where: { boardId, userId } }),
    prisma.cardAssignee.deleteMany({
      where: { userId, card: { list: { boardId } } },
    }),
  ]);
  return removed.count;
}
