import "server-only";
import { prisma } from "@/app/lib/prisma";
import { hashPassword, verifyPassword } from "@/app/lib/auth";
import { deleteBoardWithAttachments } from "@/app/lib/services/attachments";
import { isUniqueViolation } from "@/app/lib/services/users";

// Lo que cada persona hace con SU propia cuenta desde /settings: perfil, contraseña,
// sesiones y los derechos del RGPD (acceso y portabilidad con la exportación, supresión con
// el borrado). Sin contexto de request ni auditoría, como services/users.ts: la Server
// Action resuelve quién es el usuario y registra el evento. Ver docs/privacy.md.

export type UpdateProfileResult =
  | { ok: true; emailChanged: boolean }
  | { ok: false; error: "not_found" | "wrong_password" | "email_taken" };

/**
 * Cambia el nombre y, si se pide, el email. Cambiar el email exige la contraseña actual:
 * con una sesión robada (un portátil abierto) se podría desviar la cuenta a otro correo.
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
 * Cambia la contraseña comprobando la actual y cierra las DEMÁS sesiones: si alguien más
 * tenía la contraseña, pierde el acceso al momento. La sesión desde la que se cambia sigue
 * abierta. Los tokens de API se conservan: los crea la propia persona y no dependen de la
 * contraseña (el reset del admin sí los borra, porque supone una cuenta comprometida).
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

/** Sesiones vigentes (sin revocar y sin caducar), la más reciente primero. */
export async function listActiveSessions(userId: string, now: Date) {
  return prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: now } },
    select: { id: true, userAgent: true, createdAt: true, expiresAt: true },
    orderBy: { createdAt: "desc" },
  });
}

/** Cierra una sesión propia. Devuelve 0 si no existe o es de otra persona. */
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

/** Cierra todas las sesiones propias menos la actual. */
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
  | { ok: false; error: "not_found" | "wrong_password" | "last_admin" };

/**
 * Borra la cuenta y todo lo que cuelga de ella (derecho de supresión, art. 17 RGPD):
 *
 * - Los tableros que creó, con sus listas, tarjetas y los FICHEROS de sus adjuntos
 *   (deleteBoardWithAttachments, que borra también el disco).
 * - Por cascada del esquema: sesiones, tokens, membresías, asignaciones, comentarios y
 *   notificaciones.
 * - En la auditoría, las filas quedan sin usuario (onDelete: SetNull) y se vacía el
 *   `detail` de las que le tenían como objetivo, que podía llevar su email.
 *
 * La última cuenta ADMIN no puede borrarse: la instancia se quedaría sin nadie que la
 * administre. La comprobación bloquea las filas de los admins (FOR UPDATE) para que dos
 * admins que se borran a la vez no dejen la instancia sin ninguno.
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

  // Tableros uno a uno: cada borrado bloquea su árbol y luego borra los ficheros (ver
  // services/attachments.ts). Se repite por si se crea uno mientras tanto (otra pestaña o
  // la API), para que el DELETE final con `boards: none` no falle por esa carrera.
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
    if (result === "deleted") return { ok: true, boardsDeleted };
  }
  throw new Error("No se pudo borrar la cuenta: siguen apareciendo tableros nuevos");
}

/**
 * Exportación de los datos personales (derechos de acceso y portabilidad, arts. 15 y 20
 * RGPD) en JSON legible por máquina. Incluye todo lo que la instancia guarda de la persona
 * o ha creado ella; de los tableros ajenos solo su pertenencia y lo que ella escribió.
 * Nunca incluye hashes (contraseña, tokens) ni los binarios de los adjuntos.
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
