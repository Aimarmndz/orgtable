import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { accessibleBoardsWhere } from "@/app/lib/access";
import { boardRoleFromMembership, canManageBoard, maxBoardRole } from "@/app/lib/roles";
import { permissionsOf } from "@/app/lib/permissions";

// Read queries. Authorization (which boards a user can see) is expressed in the WHERE
// itself, always with accessibleBoardsWhere (app/lib/access.ts).

export async function getBoardsForUser(userId: string) {
  return prisma.board.findMany({
    where: accessibleBoardsWhere(userId),
    orderBy: { updatedAt: "desc" },
    include: { workspace: { select: { slug: true } } },
  });
}

/**
 * The user's boards with what their tile shows: how many cards they hold, who else is in
 * them, where they live (/<workspace>/<slug>) and whether the user may manage them (delete).
 * `workspaceId` narrows them to one workspace (its page). Separate from getBoardsForUser so
 * the shape returned by the public API does not change.
 */
export async function getBoardSummariesForUser(userId: string, workspaceId?: string) {
  const boards = await prisma.board.findMany({
    where: workspaceId
      ? { AND: [{ workspaceId }, accessibleBoardsWhere(userId)] }
      : accessibleBoardsWhere(userId),
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      slug: true,
      background: true,
      ownerId: true,
      visibility: true,
      workspace: {
        select: {
          id: true,
          slug: true,
          members: { where: { userId }, select: { role: true, customRole: { select: { permissions: true } } } },
        },
      },
      lists: { select: { _count: { select: { cards: true } } } },
      members: {
        orderBy: { addedAt: "asc" },
        select: { role: true, user: { select: { id: true, name: true } } },
      },
    },
  });
  return boards.map(({ lists, members, workspace, ...b }) => {
    const explicit = members.find((m) => m.user.id === userId)?.role ?? null;
    const membership = workspace.members[0];
    const fromWorkspace = membership ? boardRoleFromMembership(membership, b.visibility) : null;
    const role = maxBoardRole(explicit, fromWorkspace);
    const perms = membership ? permissionsOf(membership.role, membership.customRole?.permissions) : null;
    return {
      ...b,
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      // Who manages the board, or holds "boards.delete" in its organization (permissions.ts).
      canDelete: role !== null && (canManageBoard(role) || Boolean(perms?.has("boards.delete"))),
      cardCount: lists.reduce((n, l) => n + l._count.cards, 0),
      members: members.map((m) => m.user),
    };
  });
}

export type BoardSummary = Awaited<ReturnType<typeof getBoardSummariesForUser>>[number];

/**
 * The workspaces the user belongs to, personal first, then organizations by name, with
 * their role. For /boards and the "new board" workspace picker.
 */
export async function getWorkspacesForUser(userId: string) {
  const rows = await prisma.workspaceMember.findMany({
    where: { userId },
    select: {
      role: true,
      customRole: { select: { permissions: true } },
      workspace: {
        select: { id: true, slug: true, name: true, kind: true, suspendedAt: true },
      },
    },
  });
  return rows
    .map((r) => ({
      ...r.workspace,
      role: r.role,
      // Personal workspaces always; organizations with "boards.create" (permissions.ts).
      canCreateBoards:
        r.workspace.kind === "PERSONAL" ||
        permissionsOf(r.role, r.customRole?.permissions).has("boards.create"),
    }))
    .sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "PERSONAL" ? -1 : 1,
    );
}

/**
 * A workspace by slug as the user sees it: its data, their role (null if they are not a
 * member) and whether it is suspended. Null if it does not exist, or if the user is neither
 * a member nor has access to any of its boards (the same answer, so the page does not
 * reveal which workspaces exist).
 */
export async function getWorkspaceForUser(slug: string, userId: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      kind: true,
      suspendedAt: true,
      suspendedReason: true,
      members: { where: { userId }, select: { role: true, customRole: { select: { permissions: true } } } },
    },
  });
  if (!workspace) return null;
  const membership = workspace.members[0] ?? null;
  const role = membership?.role ?? null;
  if (!role) {
    const anyBoard = await prisma.board.findFirst({
      where: { AND: [{ workspaceId: workspace.id }, accessibleBoardsWhere(userId)] },
      select: { id: true },
    });
    if (!anyBoard) return null;
  }
  return {
    id: workspace.id,
    slug: workspace.slug,
    name: workspace.name,
    kind: workspace.kind,
    suspendedAt: workspace.suspendedAt,
    suspendedReason: workspace.suspendedReason,
    role,
    canCreateBoards:
      membership !== null &&
      (workspace.kind === "PERSONAL" ||
        permissionsOf(membership.role, membership.customRole?.permissions).has("boards.create")),
  };
}

/** An organization's members, for its settings page (only for its members). */
export async function getWorkspaceMembers(workspaceId: string) {
  const rows = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    orderBy: [{ role: "asc" }, { addedAt: "asc" }],
    select: {
      role: true,
      addedAt: true,
      customRole: { select: { id: true, name: true, color: true } },
      user: { select: { id: true, name: true, email: true, managedById: true } },
    },
  });
  return rows.map((r) => ({
    id: r.user.id,
    name: r.user.name,
    email: r.user.email,
    role: r.role,
    customRole: r.customRole,
    addedAt: r.addedAt,
    managedHere: r.user.managedById === workspaceId,
  }));
}

/**
 * The board a URL names: /<workspace>/<board> where <board> is its slug or its id. Returns
 * the canonical slugs too, so the page can redirect an id or an old address to them. Does
 * NOT check access: the page loads the board with getBoardWithLists, which does.
 */
export async function findBoardByPath(workspaceSlug: string, boardRef: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { slug: workspaceSlug },
    select: { id: true },
  });
  const bySlug = workspace
    ? await prisma.board.findUnique({
        where: { workspaceId_slug: { workspaceId: workspace.id, slug: boardRef } },
        select: { id: true, slug: true, workspace: { select: { slug: true } } },
      })
    : null;
  if (bySlug) return bySlug;
  return prisma.board.findUnique({
    where: { id: boardRef },
    select: { id: true, slug: true, workspace: { select: { slug: true } } },
  });
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

/**
 * Figures of the whole service for the instance administrator (/admin/workspaces). Only
 * counts: the administrator sees no board content.
 */
export async function getInstanceStats() {
  const [users, organizations, boards, cards, activeSessions, suspended] = await Promise.all([
    prisma.user.count(),
    prisma.workspace.count({ where: { kind: "ORGANIZATION" } }),
    prisma.board.count(),
    prisma.card.count(),
    prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
    prisma.workspace.count({ where: { suspendedAt: { not: null } } }),
  ]);
  return { users, organizations, boards, cards, activeSessions, suspended };
}

/**
 * Workspaces for the instance administrator: their name, address, owners and how many
 * members and boards they have, never what the boards contain. Organizations by default;
 * `kind` PERSONAL lists the personal ones (to act on abuse), newest first.
 */
export async function getWorkspacesForAdmin(kind: "ORGANIZATION" | "PERSONAL", query = "") {
  const q = query.trim();
  return prisma.workspace.findMany({
    where: {
      kind,
      ...(q
        ? {
            OR: [
              { slug: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      slug: true,
      name: true,
      kind: true,
      createdAt: true,
      suspendedAt: true,
      suspendedReason: true,
      _count: { select: { members: true, boards: true } },
      members: {
        where: { role: "OWNER" },
        select: { user: { select: { name: true, email: true } } },
      },
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
 * Everyone who can open a board, for the members panel and the assignee picker: its
 * explicit members (with their board role) and, for organization boards, the workspace
 * members who reach it through the organization (app/lib/access.ts), marked `viaWorkspace`.
 */
export async function getBoardPeople(boardId: string, viewerId: string) {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      ownerId: true,
      visibility: true,
      members: {
        orderBy: { addedAt: "asc" },
        select: { role: true, user: { select: { id: true, name: true, email: true } } },
      },
      workspace: {
        select: {
          members: {
            orderBy: { addedAt: "asc" },
            select: {
              role: true,
              customRole: { select: { permissions: true } },
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      },
    },
  });
  if (!board) return [];
  const workspaceGrant = (userId: string) => {
    const w = board.workspace.members.find((x) => x.user.id === userId);
    return w ? boardRoleFromMembership(w, board.visibility) : null;
  };
  const people = board.members.map((m) => ({
    ...m.user,
    // The effective role: the higher of the board's and the one the organization gives.
    role: maxBoardRole(m.role, workspaceGrant(m.user.id)) ?? m.role,
    isOwner: m.user.id === board.ownerId,
    viaWorkspace: false,
  }));
    const explicit = new Set(people.map((p) => p.id));
  // A guest (someone added to this board but not to its organization) sees the names of
  // the organization's people, not their email addresses: the organization's directory is
  // not theirs to read.
  const viewerInWorkspace = board.workspace.members.some((w) => w.user.id === viewerId);
  for (const w of board.workspace.members) {
    if (explicit.has(w.user.id)) continue;
    const role = boardRoleFromMembership(w, board.visibility);
    if (role) {
      people.push({
        ...w.user,
        email: viewerInWorkspace ? w.user.email : "",
        role,
        isOwner: false,
        viaWorkspace: true,
      });
    }
  }
  return people;
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
          accessibleBoardsWhere(userId),
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
              board: accessibleBoardsWhere(userId),
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

// Access guard of the board page (app/lib/access.ts). Shared by the page and its <title> so
// the title never reveals the name of someone else's board.
function boardAccessWhere(
  boardId: string,
  userId: string,
): Prisma.BoardWhereInput {
  return { AND: [{ id: boardId }, accessibleBoardsWhere(userId)] };
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
      workspace: { select: { slug: true, name: true, kind: true } },
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
