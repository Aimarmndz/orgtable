"use server";

import { prisma } from "@/app/lib/prisma";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { requireBoardAccess } from "@/app/lib/dal";
import { canManageBoard } from "@/app/lib/roles";
import { recordAudit } from "@/app/lib/audit";
import { notify, recipientI18n } from "@/app/lib/notifications";
import { getI18n, i18nFor, issueMessage } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";
import { removeMemberFromBoard } from "@/app/lib/services/members";
import { workspaceEmailAllowed } from "@/app/lib/services/org-security";
import { addMemberSchema, assignableBoardRoleSchema } from "@/app/lib/validators";

// Board member management. Only the OWNER can invite, change the role of or remove members.
// Only existing users can be invited (created by the administrator, see actions/admin.ts,
// or through open registration). See docs/authorization.md.
//
// Notifications are written in the recipient's language; the messages returned to the
// form, in the actor's.

// `values` returns what was sent when there is an error: React resets the form after the
// action, and without this the email field would be cleared just when it needs fixing.
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

/** Invites an existing user (by email) to a board with a role (EDITOR/VIEWER). */
export async function addBoardMember(
  _prev: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const boardId = String(formData.get("boardId"));
  const values = submittedValues(formData);
  const { user: actor, role: actorRole } = await requireBoardAccess(boardId);
  const { m } = await getI18n();
  if (!canManageBoard(actorRole)) {
    return { error: m.errors.members.ownerOnly, values };
  }

  const parsed = addMemberSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return {
      error: issueMessage(m, parsed.error.issues[0]),
      values,
    };
  }

    const [user, target] = await Promise.all([
    prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
      select: { id: true, name: true, locale: true, managedById: true },
    }),
    prisma.board.findUnique({ where: { id: boardId }, select: { workspaceId: true } }),
  ]);
  // An account an organization created for an employee can only be invited to that
  // organization's boards: the organization controls its password, so letting it receive
  // invitations from anyone else would let an organization register someone's email and
  // read what they are invited to. Same answer as an unknown email.
  if (!user || (user.managedById && user.managedById !== target?.workspaceId)) {
    return { error: m.errors.members.userNotFound, values };
  }
  // An organization that limits its email domains (docs/workspaces.md, "Security") does not
  // take guests from other domains on its boards either.
  if (target && !(await workspaceEmailAllowed(target.workspaceId, parsed.data.email))) {
    return { error: m.errors.workspaces.domainNotAllowed, values };
  }

  const existing = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId: user.id } },
    select: { userId: true },
  });
  if (existing) {
    return { error: fmt(m.errors.members.alreadyMember, { name: user.name }), values };
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
  // Notify the invitee, in their language.
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { title: true },
  });
  const forInvitee = i18nFor(user.locale).m.notifications;
  await notify({
    userId: user.id,
    type: "member.added",
    title: fmt(forInvitee.memberAdded.title, { board: board?.title ?? forInvitee.someBoard }),
    body: fmt(forInvitee.memberAdded.body, { role: forInvitee.roles[parsed.data.role] }),
    boardId,
  });
  revalidateBoard(boardId);
  return {
    message: fmt(m.errors.members.added, {
      name: user.name,
      role: m.notifications.roles[parsed.data.role],
    }),
  };
}

/** Changes a member's role (the board owner's cannot be changed). */
export async function updateBoardMemberRole(formData: FormData): Promise<void> {
  const boardId = String(formData.get("boardId"));
  const userId = String(formData.get("userId"));
  const { user: actor, role: actorRole } = await requireBoardAccess(boardId);
  if (!canManageBoard(actorRole)) return;

  const parsed = assignableBoardRoleSchema.safeParse(formData.get("role"));
  if (!parsed.success) return;

  // The board owner (Board.ownerId) always keeps the OWNER role.
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { ownerId: true, title: true },
  });
  if (!board || board.ownerId === userId) return;

  // It only counts if the user IS a member and their role really changes: with an unrelated
  // userId or the same role there is nothing to audit or notify (avoids false notifications
  // that, moreover, would reveal the board title to a non-member).
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
  const { m } = await recipientI18n(userId);
  await notify({
    userId,
    type: "member.role_changed",
    title: fmt(m.notifications.memberRoleChanged.title, { board: board.title }),
    body: fmt(m.notifications.memberRoleChanged.body, {
      role: m.notifications.roles[parsed.data],
    }),
    boardId,
  });
  revalidateBoard(boardId);
}

/** Removes a member from the board (the owner cannot be removed). */
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

  // If they were not a member (unrelated userId or repeated removal) nothing is audited or
  // notified.
  const removed = await removeMemberFromBoard(boardId, userId);
  if (removed === 0) return;
  await recordAudit({
    action: "member.removed",
    userId: actor.id,
    targetType: "board",
    targetId: boardId,
    detail: userId,
  });
  // No boardId: the user no longer has access, so the notification has no link.
  const { m } = await recipientI18n(userId);
  await notify({
    userId,
    type: "member.removed",
    title: fmt(m.notifications.memberRemoved.title, { board: board.title }),
  });
  revalidateBoard(boardId);
}
