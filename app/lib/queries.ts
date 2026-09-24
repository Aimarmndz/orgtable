import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
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

// --- Hito 8: notificaciones ---

/** Notificaciones del usuario, más recientes primero (para la campana de la navbar). */
export async function getNotificationsForUser(userId: string, limit = 20) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      boardId: true,
      cardId: true,
      read: true,
      createdAt: true,
    },
  });
}

/** Cuántas notificaciones sin leer tiene el usuario (badge de la campana). */
export async function getUnreadNotificationCount(userId: string) {
  return prisma.notification.count({ where: { userId, read: false } });
}

// --- Hito 9: API pública (tokens de acceso) ---

/** Tokens de API del usuario (sin el hash). Para la página /settings. */
export async function getApiTokensForUser(userId: string) {
  return prisma.apiToken.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      scope: true,
      expiresAt: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });
}

// --- Hito 6: búsqueda global ---

export type SearchResults = {
  boards: { id: string; title: string; background: string | null }[];
  cards: {
    id: string;
    title: string;
    boardId: string;
    boardTitle: string;
    boardBackground: string | null;
    listTitle: string;
  }[];
};

/**
 * Búsqueda global acotada a lo que el usuario puede ver: tableros donde es dueño o
 * miembro, y tarjetas dentro de esos tableros. Coincidencia por subcadena insensible
 * a mayúsculas (ILIKE, vía Prisma `contains` + `mode: "insensitive"`). El filtro de
 * acceso se repite en el WHERE de cada consulta, igual que en getBoardsForUser: el
 * servidor es la única autoridad, nunca confiamos en el cliente. Ver docs/search.md.
 */
export async function searchForUser(
  userId: string,
  query: string,
): Promise<SearchResults> {
  const q = query.trim();
  // Evita consultas con un único carácter (demasiado ruido y carga).
  if (q.length < 2) return { boards: [], cards: [] };

  const [boards, cards] = await Promise.all([
    prisma.board.findMany({
      where: {
        AND: [
          { OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
          {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
            ],
          },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: { id: true, title: true, background: true },
    }),
    prisma.card.findMany({
      where: {
        AND: [
          {
            list: {
              board: {
                OR: [{ ownerId: userId }, { members: { some: { userId } } }],
              },
            },
          },
          {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
            ],
          },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: {
        id: true,
        title: true,
        list: {
          select: {
            title: true,
            board: { select: { id: true, title: true, background: true } },
          },
        },
      },
    }),
  ]);

  return {
    boards,
    cards: cards.map((c) => ({
      id: c.id,
      title: c.title,
      boardId: c.list.board.id,
      boardTitle: c.list.board.title,
      boardBackground: c.list.board.background,
      listTitle: c.list.title,
    })),
  };
}

// Guarda de acceso de la página del tablero: dueño o miembro. La comparten la página y
// su <title> para que el título nunca revele el nombre de un tablero ajeno.
function boardAccessWhere(
  boardId: string,
  userId: string,
): Prisma.BoardWhereInput {
  return {
    id: boardId,
    OR: [{ ownerId: userId }, { members: { some: { userId } } }],
  };
}

/** Título del tablero si el usuario tiene acceso; null si no. Para generateMetadata. */
export const getBoardTitleForUser = cache(
  async (boardId: string, userId: string): Promise<string | null> => {
    const board = await prisma.board.findFirst({
      where: boardAccessWhere(boardId, userId),
      select: { title: true },
    });
    return board?.title ?? null;
  },
);

export async function getBoardWithLists(boardId: string, userId: string) {
  return prisma.board.findFirst({
    where: boardAccessWhere(boardId, userId),
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
              attachments: { orderBy: { createdAt: "asc" } },
              assignees: {
                include: { user: { select: { id: true, name: true } } },
              },
              comments: {
                orderBy: { createdAt: "asc" },
                include: { author: { select: { id: true, name: true } } },
              },
            },
          },
        },
      },
    },
  });
}
