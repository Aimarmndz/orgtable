import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";

// Read queries. Authorization (which boards a user can see) is expressed in the WHERE
// itself: owner or member of the board.

export async function getBoardsForUser(userId: string) {
  return prisma.board.findMany({
    where: {
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * The user's boards with what their tile on /boards shows: how many cards they hold and
 * who else is in them. Separate from getBoardsForUser so the shape returned by the public
 * API does not change.
 */
export async function getBoardSummariesForUser(userId: string) {
  const boards = await prisma.board.findMany({
    where: {
      OR: [{ ownerId: userId }, { members: { some: { userId } } }],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      background: true,
      ownerId: true,
      lists: { select: { _count: { select: { cards: true } } } },
      members: {
        orderBy: { addedAt: "asc" },
        select: { user: { select: { id: true, name: true } } },
      },
    },
  });
  return boards.map(({ lists, members, ...b }) => ({
    ...b,
    cardCount: lists.reduce((n, l) => n + l._count.cards, 0),
    members: members.map((m) => m.user),
  }));
}

/** Every user of the instance, for the administration panel. */
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

/** Most recent audit events, for the /admin/audit panel. */
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
 * Members of a board (with user data) plus the ownerId, for the members panel. The owner
 * is identified from ownerId.
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

/** The user's notifications, newest first (for the navbar bell). */
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

/** How many unread notifications the user has (bell badge). */
export async function getUnreadNotificationCount(userId: string) {
  return prisma.notification.count({ where: { userId, read: false } });
}

/** The user's API tokens (without the hash). For the /settings page. */
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
 * Global search limited to what the user can see: boards they own or are a member of, and
 * cards in those boards. Case-insensitive substring match (ILIKE, via Prisma `contains` +
 * `mode: "insensitive"`). The access filter is repeated in each query's WHERE, as in
 * getBoardsForUser: the server is the only authority, the client is never trusted. See
 * docs/search.md.
 */
export async function searchForUser(
  userId: string,
  query: string,
): Promise<SearchResults> {
  const q = query.trim();
  // Skips single-character queries (too much noise and load).
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

// Access guard of the board page: owner or member. Shared by the page and its <title> so
// the title never reveals the name of someone else's board.
function boardAccessWhere(
  boardId: string,
  userId: string,
): Prisma.BoardWhereInput {
  return {
    id: boardId,
    OR: [{ ownerId: userId }, { members: { some: { userId } } }],
  };
}

/** Board title if the user has access; null otherwise. For generateMetadata. */
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
