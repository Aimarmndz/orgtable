import "server-only";
import { prisma } from "@/app/lib/prisma";

// Consultas de lectura. La autorización (qué tableros puede ver un usuario) se
// expresa en el propio WHERE: dueño o miembro del tablero.

export async function getBoardsForUser(userId: string) {
  return prisma.board.findMany({
    where: {
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    orderBy: { updatedAt: "desc" },
  });
}

// --- Hito 3: multiusuario ---

/** Todos los usuarios de la instancia, para el panel de administración. */
export async function getAllUsers() {
  return prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      _count: { select: { boards: true, memberships: true } },
    },
  });
}

/** Eventos de auditoría más recientes, para el panel /admin/audit. */
export async function getRecentAuditLogs(limit = 200) {
  return prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      detail: true,
      ip: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
}

/**
 * Miembros de un tablero (con datos del usuario) más el ownerId, para el panel de
 * miembros. El propietario se marca a partir de ownerId.
 */
export async function getBoardMembers(boardId: string) {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      ownerId: true,
      members: {
        orderBy: { addedAt: "asc" },
        select: {
          role: true,
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });
  return board;
}

export async function getBoardWithLists(boardId: string, userId: string) {
  return prisma.board.findFirst({
    where: {
      id: boardId,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    include: {
      labels: { orderBy: { name: "asc" } },
      lists: {
        orderBy: { position: "asc" },
        include: {
          cards: {
            orderBy: { position: "asc" },
            include: {
              labels: { include: { label: true } },
              checklists: {
                orderBy: { position: "asc" },
                include: { items: { orderBy: { position: "asc" } } },
              },
            },
          },
        },
      },
    },
  });
}
