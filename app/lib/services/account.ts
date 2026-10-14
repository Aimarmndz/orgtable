import "server-only";
import { prisma } from "@/app/lib/prisma";
import { prepareAccountDeletion, soleOwnedOrganizations } from "@/app/lib/services/workspaces";
import { hashPassword, verifyPassword } from "@/app/lib/auth";
import { deleteBoardWithAttachments } from "@/app/lib/services/attachments";
import { isUniqueViolation } from "@/app/lib/services/users";

// What each person does with THEIR OWN account from /settings: profile, password,
// sessions and the GDPR rights (access and portability via the export, erasure via
// deletion). No request context or auditing, like services/users.ts: the Server Action
// resolves who the user is and records the event. See docs/privacy.md.

export type UpdateProfileResult =
  | { ok: true; emailChanged: boolean }
  | { ok: false; error: "not_found" | "wrong_password" | "email_taken" };

/**
 * Changes the name and, if requested, the email. Changing the email requires the current
 * password: with a stolen session (an unlocked laptop) the account could be diverted to
 * another address.
 */
export async function updateOwnProfile(
  userId: string,
  input: { name: string; email: string; currentPassword: string },
): Promise<UpdateProfileResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, passwordHash: true },
  });
  if (!user) return { ok: false, error: "not_found" };

  const email = input.email.trim().toLowerCase();
  const emailChanged = email !== user.email;
  if (emailChanged && !(await verifyPassword(input.currentPassword, user.passwordHash))) {
    return { ok: false, error: "wrong_password" };
  }

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { name: input.name, email },
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "email_taken" };
    throw e;
  }
  return { ok: true, emailChanged };
}

export type ChangePasswordResult =
  | { ok: true; revokedSessions: number }
  | { ok: false; error: "not_found" | "wrong_password" };

/**
 * Changes the password after checking the current one and closes the OTHER sessions: if
 * someone else had the password, they lose access immediately. The session making the
 * change stays open. API tokens are kept: the person creates them and they do not depend
 * on the password (the admin reset does delete them, since it implies a compromised
 * account).
 */
export async function changeOwnPassword(
  userId: string,
  input: { currentPassword: string; newPassword: string; keepSessionId: string },
): Promise<ChangePasswordResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) return { ok: false, error: "not_found" };
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    return { ok: false, error: "wrong_password" };
  }

  const passwordHash = await hashPassword(input.newPassword);
  const [, revoked] = await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.session.updateMany({
      where: { userId, revokedAt: null, id: { not: input.keepSessionId } },
      data: { revokedAt: new Date() },
    }),
  ]);
  return { ok: true, revokedSessions: revoked.count };
}

/** Active sessions (not revoked and not expired), most recent first. */
export async function listActiveSessions(userId: string, now: Date) {
  return prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now } },
    select: { id: true, userAgent: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Closes one of the user's own sessions. Returns 0 if missing or someone else's. */
export async function revokeOwnSession(
  userId: string,
  sessionId: string,
): Promise<number> {
  const { count } = await prisma.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count;
}

/** Closes all of the user's own sessions except the current one. */
export async function revokeOtherSessions(
  userId: string,
  keepSessionId: string,
): Promise<number> {
  const { count } = await prisma.session.updateMany({
    where: { userId, revokedAt: null, id: { not: keepSessionId } },
    data: { revokedAt: new Date() },
  });
  return count;
}

export type DeleteOwnAccountResult =
  | { ok: true; boardsDeleted: number }
  | { ok: false; error: "not_found" | "wrong_password" | "last_admin" }
  | { ok: false; error: "sole_owner"; organizations: string[] };

/**
 * Deletes the account and everything hanging off it (right to erasure, GDPR art. 17):
 *
 * - The boards it created, with their lists, cards and the FILES of their attachments
 *   (deleteBoardWithAttachments, which also cleans up the disk).
 * - Via schema cascade: sessions, tokens, memberships, assignments, comments and
 *   notifications.
 * - In the audit log, rows are left without a user (onDelete: SetNull) and the `detail`
 *   of rows targeting the user, which could contain their email, is cleared.
 *
 * The last ADMIN account cannot be deleted: the instance would be left with nobody to
 * administer it. The check locks the admin rows (FOR UPDATE) so that two admins deleting
 * themselves at the same time cannot leave the instance with none.
 */
export async function deleteOwnAccount(
  userId: string,
  password: string,
): Promise<DeleteOwnAccountResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, role: true },
  });
  if (!user) return { ok: false, error: "not_found" };
  if (!(await verifyPassword(password, user.passwordHash))) {
    return { ok: false, error: "wrong_password" };
  }
  if (user.role === "ADMIN") {
    const otherAdmins = await prisma.user.count({
      where: { role: "ADMIN", id: { not: userId } },
    });
    if (otherAdmins === 0) return { ok: false, error: "last_admin" };
  }

  // Organizations: the ones only this person owns (with other members) block the
  // deletion; the rest are deleted (if alone) or keep the boards they created under
  // another owner (services/workspaces.ts). Their personal workspace goes with the account.
  const organizations = await prepareAccountDeletion(userId);
  if (!organizations.ok) {
    return { ok: false, error: "sole_owner", organizations: organizations.organizations };
  }

  // Boards one by one: each deletion locks its tree and then removes the files (see
  // services/attachments.ts). Retried in case one is created meanwhile (another tab or
  // the API), so the final DELETE with `boards: none` does not fail because of that race.
  let boardsDeleted = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const owned = await prisma.board.findMany({
      where: { ownerId: userId },
      select: { id: true },
    });
    for (const b of owned) {
      boardsDeleted += await deleteBoardWithAttachments({ id: b.id, ownerId: userId });
    }

    const result = await prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT 1 FROM "User" WHERE role = 'ADMIN' FOR UPDATE`;
      // Re-checked under lock: another owner may have left meanwhile.
      if ((await soleOwnedOrganizations(tx, userId)).length > 0) return "sole_owner" as const;
      if (user.role === "ADMIN") {
        const others = await tx.user.count({
          where: { role: "ADMIN", id: { not: userId } },
        });
        if (others === 0) return "last_admin" as const;
      }
      await tx.auditLog.updateMany({
        where: { targetType: "user", targetId: userId },
        data: { detail: null },
      });
      const { count } = await tx.user.deleteMany({
        where: { id: userId, boards: { none: {} } },
      });
      return count > 0 ? ("deleted" as const) : ("owns_boards" as const);
    });

        if (result === "last_admin") return { ok: false, error: "last_admin" };
    if (result === "sole_owner") {
      const again = await prepareAccountDeletion(userId);
      return { ok: false, error: "sole_owner", organizations: again.ok ? [] : again.organizations };
    }
    if (result === "deleted") return { ok: true, boardsDeleted };
  }
  throw new Error("Could not delete the account: new boards keep appearing");
}

/**
 * Personal data export (rights of access and portability, GDPR arts. 15 and 20) as
 * machine-readable JSON. Includes everything the instance stores about the person or that
 * they created; for other people's boards, only their membership and what they wrote.
 * Never includes hashes (password, tokens) or attachment binaries.
 */
export async function exportUserData(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      updatedAt: true,
      termsAcceptedAt: true,
    },
  });
  if (!user) return null;

  const [ownedBoards, memberships, comments, assigned, notifications, sessions, tokens, audit] =
    await Promise.all([
      prisma.board.findMany({
        where: { ownerId: userId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          background: true,
          createdAt: true,
          labels: { select: { name: true, color: true } },
          lists: {
            orderBy: { position: "asc" },
            select: {
              title: true,
              cards: {
                orderBy: { position: "asc" },
                select: {
                  title: true,
                  description: true,
                  dueDate: true,
                  createdAt: true,
                  labels: { select: { label: { select: { name: true } } } },
                  checklists: {
                    orderBy: { position: "asc" },
                    select: {
                      title: true,
                      items: {
                        orderBy: { position: "asc" },
                        select: { text: true, done: true },
                      },
                    },
                  },
                  attachments: {
                    select: { filename: true, mimeType: true, size: true, createdAt: true },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.boardMember.findMany({
        where: { userId },
        select: { role: true, addedAt: true, board: { select: { id: true, title: true } } },
      }),
      prisma.comment.findMany({
        where: { authorId: userId },
        orderBy: { createdAt: "asc" },
        select: {
          text: true,
          createdAt: true,
          card: { select: { title: true, list: { select: { boardId: true } } } },
        },
      }),
      prisma.cardAssignee.findMany({
        where: { userId },
        select: { card: { select: { title: true, list: { select: { boardId: true } } } } },
      }),
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: { type: true, title: true, body: true, read: true, createdAt: true },
      }),
      prisma.session.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: { userAgent: true, createdAt: true, expiresAt: true, revokedAt: true },
      }),
      prisma.apiToken.findMany({
        where: { userId },
        select: {
          name: true,
          prefix: true,
          scope: true,
          createdAt: true,
          expiresAt: true,
          lastUsedAt: true,
        },
      }),
      prisma.auditLog.findMany({
        where: { OR: [{ userId }, { targetType: "user", targetId: userId }] },
        orderBy: { createdAt: "asc" },
        select: { action: true, ip: true, createdAt: true },
      }),
    ]);

  return {
    orgtable: { type: "account", version: 1, exportedAt: new Date().toISOString() },
    account: user,
    ownedBoards: ownedBoards.map((b) => ({
      ...b,
      lists: b.lists.map((l) => ({
        ...l,
        cards: l.cards.map((c) => ({ ...c, labels: c.labels.map((x) => x.label.name) })),
      })),
    })),
    memberships: memberships.map((m) => ({
      boardId: m.board.id,
      boardTitle: m.board.title,
      role: m.role,
      addedAt: m.addedAt,
    })),
    comments: comments.map((c) => ({
      text: c.text,
      createdAt: c.createdAt,
      cardTitle: c.card.title,
      boardId: c.card.list.boardId,
    })),
    assignedCards: assigned.map((a) => ({
      cardTitle: a.card.title,
      boardId: a.card.list.boardId,
    })),
    notifications,
    sessions,
    apiTokens: tokens,
    securityLog: audit,
  };
}

export type UserDataExport = NonNullable<Awaited<ReturnType<typeof exportUserData>>>;
