import "server-only";
import { prisma } from "@/app/lib/prisma";
import { accessibleBoardsWhere } from "@/app/lib/access";

/** Boards of the organization the person can open (a board webhook needs that). */
export async function boardsForWebhooks(workspaceId: string, userId: string) {
  return prisma.board.findMany({
    where: { AND: [{ workspaceId }, accessibleBoardsWhere(userId)] },
    orderBy: { title: "asc" },
    select: { id: true, title: true },
  });
}
