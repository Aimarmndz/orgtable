"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { requireUser, requireBoardAccess } from "@/app/lib/dal";
import { canManageBoard } from "@/app/lib/roles";
import { recordAudit } from "@/app/lib/audit";
import { boardTitleSchema } from "@/app/lib/validators";

export async function createBoard(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = boardTitleSchema.safeParse(formData.get("title"));
  if (!parsed.success) return;

  // El creador queda como dueño y, a la vez, como miembro OWNER del tablero (la
  // autorización siempre se comprueba contra board_members).
  const board = await prisma.board.create({
    data: {
      title: parsed.data,
      ownerId: user.id,
      members: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  await recordAudit({
    action: "board.created",
    userId: user.id,
    targetType: "board",
    targetId: board.id,
    detail: board.title,
  });
  revalidatePath("/boards");
  redirect(`/board/${board.id}`);
}

export async function renameBoard(formData: FormData): Promise<void> {
  const boardId = String(formData.get("boardId"));
  const { role } = await requireBoardAccess(boardId);
  if (!canManageBoard(role)) return;
  const parsed = boardTitleSchema.safeParse(formData.get("title"));
  if (!parsed.success) return;

  await prisma.board.update({
    where: { id: boardId },
    data: { title: parsed.data },
  });
  revalidateBoard(boardId);
}

export async function deleteBoard(formData: FormData): Promise<void> {
  const user = await requireUser();
  const boardId = String(formData.get("boardId"));
  // Solo el dueño puede borrar el tablero (deleteMany no falla si no coincide).
  const { count } = await prisma.board.deleteMany({
    where: { id: boardId, ownerId: user.id },
  });
  if (count > 0) {
    await recordAudit({
      action: "board.deleted",
      userId: user.id,
      targetType: "board",
      targetId: boardId,
    });
  }
  revalidatePath("/boards");
  redirect("/boards");
}
