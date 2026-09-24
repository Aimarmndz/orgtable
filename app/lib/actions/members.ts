"use server";

import { prisma } from "@/app/lib/prisma";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { requireBoardAccess } from "@/app/lib/dal";
import { canManageBoard, BOARD_ROLE_LABELS } from "@/app/lib/roles";
import { recordAudit } from "@/app/lib/audit";
import { notify } from "@/app/lib/notifications";
import { removeMemberFromBoard } from "@/app/lib/services/members";
import { addMemberSchema, assignableBoardRoleSchema } from "@/app/lib/validators";

// Gestión de miembros de un tablero (Hito 3). Solo el PROPIETARIO (OWNER) puede
// invitar, cambiar el rol o quitar miembros. No hay registro abierto: solo se puede
// invitar a usuarios que ya existen (el administrador los crea, ver actions/admin.ts).
// Ver docs/authorization.md.

// `values` devuelve lo que se envió cuando hay error: React resetea el formulario tras la
// acción, y sin esto el campo de email se vaciaría justo cuando hay que corregirlo.
export type MemberActionState = {
  error?: string;
  message?: string;
  values?: { email: string; role: string };
};

function submittedValues(formData: FormData): { email: string; role: string } {
  const email = formData.get("email");
  const role = formData.get("role");
  return {
    email: typeof email === "string" ? email : "",
    role: typeof role === "string" ? role : "",
  };
}

/** Invita a un usuario existente (por email) a un tablero con un rol (EDITOR/VIEWER). */
export async function addBoardMember(
  _prev: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const boardId = String(formData.get("boardId"));
  const values = submittedValues(formData);
  const { user: actor, role: actorRole } = await requireBoardAccess(boardId);
  if (!canManageBoard(actorRole)) {
    return { error: "Solo el propietario puede gestionar los miembros.", values };
  }

  const parsed = addMemberSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Datos no válidos.",
      values,
    };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
    select: { id: true, name: true },
  });
  if (!user) {
    return {
      error:
        "No existe ningún usuario con ese email. Pídele al administrador que cree la cuenta primero.",
      values,
    };
  }

  const existing = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId: user.id } },
    select: { userId: true },
  });
  if (existing) {
    return { error: `${user.name} ya es miembro de este tablero.`, values };
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
  // Notifica al invitado (Hito 8).
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { title: true },
  });
  await notify({
    userId: user.id,
    type: "member.added",
    title: `Te han añadido a «${board?.title ?? "un tablero"}»`,
    body: `Como ${BOARD_ROLE_LABELS[parsed.data.role]}.`,
    boardId,
  });
  revalidateBoard(boardId);
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
    select: { ownerId: true, title: true },
  });
  if (!board || board.ownerId === userId) return;

  // Solo cuenta si el usuario ES miembro y su rol cambia de verdad: con un userId ajeno o
  // el mismo rol no hay nada que auditar ni notificar (evita avisos falsos que, además,
  // revelarían el título del tablero a quien no es miembro).
  const { count } = await prisma.boardMember.updateMany({
    where: { boardId, userId, role: { not: parsed.data } },
    data: { role: parsed.data },
  });
  if (count === 0) return;
  await recordAudit({
    action: "member.role_changed",
    userId: actor.id,
    targetType: "board",
    targetId: boardId,
    detail: `${userId} → ${parsed.data}`,
  });
  await notify({
    userId,
    type: "member.role_changed",
    title: `Tu rol en «${board.title}» ha cambiado`,
    body: `Ahora eres ${BOARD_ROLE_LABELS[parsed.data]}.`,
    boardId,
  });
  revalidateBoard(boardId);
}

/** Quita a un miembro del tablero (no se puede quitar al propietario). */
export async function removeBoardMember(formData: FormData): Promise<void> {
  const boardId = String(formData.get("boardId"));
  const userId = String(formData.get("userId"));
  const { user: actor, role: actorRole } = await requireBoardAccess(boardId);
  if (!canManageBoard(actorRole)) return;

  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { ownerId: true, title: true },
  });
  if (!board || board.ownerId === userId) return;

  // Si no era miembro (userId ajeno o expulsión repetida) no se audita ni se notifica.
  const removed = await removeMemberFromBoard(boardId, userId);
  if (removed === 0) return;
  await recordAudit({
    action: "member.removed",
    userId: actor.id,
    targetType: "board",
    targetId: boardId,
    detail: userId,
  });
  // Sin boardId: el usuario ya no tiene acceso, así que la notificación no enlaza.
  await notify({
    userId,
    type: "member.removed",
    title: `Te han quitado de «${board.title}»`,
  });
  revalidateBoard(boardId);
}
