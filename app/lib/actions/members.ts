"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/app/lib/prisma";
import { requireBoardAccess } from "@/app/lib/dal";
import { canManageBoard, BOARD_ROLE_LABELS } from "@/app/lib/roles";
import { recordAudit } from "@/app/lib/audit";
import { addMemberSchema, assignableBoardRoleSchema } from "@/app/lib/validators";

// Gestión de miembros de un tablero (Hito 3). Solo el PROPIETARIO (OWNER) puede
// invitar, cambiar el rol o quitar miembros. No hay registro abierto: solo se puede
// invitar a usuarios que ya existen (el administrador los crea, ver actions/admin.ts).
// Ver docs/authorization.md.

export type MemberActionState = { error?: string; message?: string };

/** Invita a un usuario existente (por email) a un tablero con un rol (EDITOR/VIEWER). */
export async function addBoardMember(
  _prev: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const boardId = String(formData.get("boardId"));
  const { user: actor, role: actorRole } = await requireBoardAccess(boardId);
  if (!canManageBoard(actorRole)) {
    return { error: "Solo el propietario puede gestionar los miembros." };
  }

  const parsed = addMemberSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    select: { id: true, name: true },
  });
  if (!user) {
    return {
      error:
        "No existe ningún usuario con ese email. Pídele al administrador que cree la cuenta primero.",
    };
  }

  const existing = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId: user.id } },
    select: { userId: true },
  });
  if (existing) {
    return { error: `${user.name} ya es miembro de este tablero.` };
  }

  await prisma.boardMember.create({
    data: { boardId, userId: user.id, role: parsed.data.role },
  });
  await recordAudit({
    action: "member.added",
    userId: actor.id,
    targetType: "board",
    targetId: boardId,
    detail: `${user.id} (${parsed.data.role})`,
  });
  revalidatePath(`/board/${boardId}`);
  return {
    message: `${user.name} añadido como ${BOARD_ROLE_LABELS[parsed.data.role]}.`,
  };
}

/** Cambia el rol de un miembro (no se puede cambiar el del propietario del tablero). */
export async function updateBoardMemberRole(formData: FormData): Promise<void> {
  const boardId = String(formData.get("boardId"));
  const userId = String(formData.get("userId"));
  const { user: actor, role: actorRole } = await requireBoardAccess(boardId);
  if (!canManageBoard(actorRole)) return;

  const parsed = assignableBoardRoleSchema.safeParse(formData.get("role"));
  if (!parsed.success) return;

  // El propietario del tablero (Board.ownerId) siempre conserva el rol OWNER.
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { ownerId: true },
  });
  if (!board || board.ownerId === userId) return;

  await prisma.boardMember.updateMany({
    where: { boardId, userId },
    data: { role: parsed.data },
  });
  await recordAudit({
    action: "member.role_changed",
    userId: actor.id,
    targetType: "board",
    targetId: boardId,
    detail: `${userId} → ${parsed.data}`,
  });
  revalidatePath(`/board/${boardId}`);
}

/** Quita a un miembro del tablero (no se puede quitar al propietario). */
export async function removeBoardMember(formData: FormData): Promise<void> {
  const boardId = String(formData.get("boardId"));
  const userId = String(formData.get("userId"));
  const { user: actor, role: actorRole } = await requireBoardAccess(boardId);
  if (!canManageBoard(actorRole)) return;

  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { ownerId: true },
  });
  if (!board || board.ownerId === userId) return;

  await prisma.boardMember.deleteMany({ where: { boardId, userId } });
  await recordAudit({
    action: "member.removed",
    userId: actor.id,
    targetType: "board",
    targetId: boardId,
    detail: userId,
  });
  revalidatePath(`/board/${boardId}`);
}
