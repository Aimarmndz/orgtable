import "server-only";
import { prisma } from "@/app/lib/prisma";

/**
 * Does the label belong to this board? toggleCardLabel authorizes by the CARD's board;
 * without this check, an editor of A could attach a label from B (just by knowing its id)
 * and expose its name and color to A's members and in the export. Isolated here so it
 * can be tested. A nonexistent id also returns false.
 */
export async function labelBelongsToBoard(
  labelId: string,
  boardId: string,
): Promise<boolean> {
  const label = await prisma.label.findFirst({
    where: { id: labelId, boardId },
    select: { id: true },
  });
  return label !== null;
}
