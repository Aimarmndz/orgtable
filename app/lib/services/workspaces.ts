import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { hashPassword } from "@/app/lib/auth";
import { isUniqueViolation } from "@/app/lib/services/users";
import { deleteBoardWithAttachments } from "@/app/lib/services/attachments";
import { isRegistrationOpen } from "@/app/lib/services/instance";
import {
  RESERVED_BOARD_SLUGS,
  RESERVED_WORKSPACE_SLUGS,
  boardSlugBase,
  firstFreeSlug,
  workspaceSlugBase,
  workspaceSlugProblem,
} from "@/app/lib/slugs";
import {
  canActOnWorkspaceMember,
  canManageWorkspace,
  canOwnWorkspace,
  grantableWorkspaceRoles,
  type WorkspaceRole,
} from "@/app/lib/roles";

// Workspaces (personal and organizations), their members and the employees an organization
// creates. Business rules only, WITHOUT request context: the Server Actions
// (app/lib/actions/workspaces.ts) resolve who is acting and audit; these functions take
// the actor's id and check everything again against the database, so they are safe to
// call from anywhere and testable directly (test/integration/workspaces.int.test.ts).
// See docs/workspaces.md and docs/authorization.md.

type Tx = Prisma.TransactionClient;

// --- Slugs --------------------------------------------------------------------------------

/** A free workspace slug derived from free text (a name). */
export async function freeWorkspaceSlug(
  db: Tx | typeof prisma,
  text: string,
): Promise<string> {
  return firstFreeSlug(
    workspaceSlugBase(text),
    RESERVED_WORKSPACE_SLUGS,
    async (slug) =>
      Boolean(
        await db.workspace.findUnique({
          where: { slug },
          select: { id: true },
        }),
      ),
  );
}

/** A free board slug in a workspace, from the board's title. */
export async function freeBoardSlug(
  db: Tx | typeof prisma,
  workspaceId: string,
  title: string,
  exceptBoardId?: string,
): Promise<string> {
  return firstFreeSlug(
    boardSlugBase(title),
    RESERVED_BOARD_SLUGS,
    async (slug) => {
      const found = await db.board.findUnique({
        where: { workspaceId_slug: { workspaceId, slug } },
        select: { id: true },
      });
      return Boolean(found && found.id !== exceptBoardId);
    },
  );
}

/**
 * Creates a board with a free slug from its title. Two boards created at the same moment
 * with the same title would both pick the same free slug; the second hits the unique index
 * and tries again instead of failing.
 */
export async function createBoardWithSlug<T>(
  workspaceId: string,
  title: string,
  create: (slug: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const slug = await freeBoardSlug(prisma, workspaceId, title);
    try {
      return await create(slug);
    } catch (e) {
      if (attempt < 3 && isUniqueViolation(e)) continue;
      throw e;
    }
  }
}

// --- Personal workspaces --------------------------------------------------------------------

/**
 * Creates the user's personal workspace (they are its OWNER). Called inside the same
 * transaction that creates the account, so no user ever lacks one. The handle comes from
 * the person's NAME, not their email, so shared URLs do not reveal email addresses.
 * INSERT … ON CONFLICT DO NOTHING keeps two simultaneous sign-ups with the same name from
 * aborting the transaction: the second simply takes the next free handle.
 */
export async function createPersonalWorkspace(
  tx: Tx,
  user: { id: string; name: string; email: string },
): Promise<{ id: string; slug: string }> {
  const base = workspaceSlugBase(
    user.name || user.email.split("@")[0] || "user",
  );
  for (let attempt = 0; attempt < 10; attempt++) {
    const slug =
      attempt === 0
        ? await freeWorkspaceSlug(tx, base)
        : `${base.slice(0, 30)}-${randomUUID().slice(0, 6)}`;
    const id = `w${randomUUID().replaceAll("-", "").slice(0, 24)}`;
    const rows = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO "Workspace" ("id", "slug", "name", "kind", "personalOwnerId", "updatedAt")
      VALUES (${id}, ${slug}, ${user.name}, 'PERSONAL'::"WorkspaceKind", ${user.id}, now())
      ON CONFLICT ("slug") DO NOTHING
      RETURNING "id"`;
    if (rows.length === 0) continue;
    await tx.workspaceMember.create({
      data: { workspaceId: id, userId: user.id, role: "OWNER" },
    });
    return { id, slug };
  }
  throw new Error("Could not find a free slug for the personal workspace");
}

/** The user's personal workspace (every account has one). */
export async function personalWorkspaceOf(userId: string) {
  return prisma.workspace.findUnique({
    where: { personalOwnerId: userId },
    select: { id: true, slug: true, name: true },
  });
}

// --- Organizations ---------------------------------------------------------------------------

export type SlugError = "slug_format" | "slug_reserved" | "slug_taken";

export type CreateOrganizationResult =
  | { ok: true; workspace: { id: string; slug: string } }
  | { ok: false; error: SlugError | "closed" };

/**
 * Organizations and their employees are new accounts on the instance, so they follow the
 * same switch as open sign-up: on a private instance (sign-up closed) only the instance
 * administrator creates them; otherwise anyone, for free.
 */
async function mayCreateAccounts(actorId: string): Promise<boolean> {
  if (await isRegistrationOpen()) return true;
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { role: true },
  });
  return actor?.role === "ADMIN";
}

/** Creates an organization owned by `ownerId`. Free, for anyone with an account. */
export async function createOrganization(input: {
  ownerId: string;
  name: string;
  slug: string;
}): Promise<CreateOrganizationResult> {
  if (!(await mayCreateAccounts(input.ownerId)))
    return { ok: false, error: "closed" };
  const slug = input.slug.trim().toLowerCase();
  const problem = workspaceSlugProblem(slug);
  if (problem)
    return {
      ok: false,
      error: problem === "format" ? "slug_format" : "slug_reserved",
    };
  try {
    const workspace = await prisma.workspace.create({
      data: {
        slug,
        name: input.name,
        kind: "ORGANIZATION",
        members: { create: { userId: input.ownerId, role: "OWNER" } },
      },
      select: { id: true, slug: true },
    });
    return { ok: true, workspace };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "slug_taken" };
    throw e;
  }
}

/**
 * A suspended organization is frozen: nobody can change its members, roles, passwords,
 * name or address, or delete it, until the instance administrator lifts the suspension
 * (the administrator can still delete it from /admin/workspaces).
 */
async function isActiveOrganization(
  workspaceId: string,
  db: Tx | typeof prisma = prisma,
) {
  const w = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { kind: true, suspendedAt: true },
  });
  return Boolean(w && w.kind === "ORGANIZATION" && !w.suspendedAt);
}

/** Renames a workspace and, optionally, changes its slug (OWNER only). */
export async function updateWorkspace(input: {
  workspaceId: string;
  actorId: string;
  name: string;
  slug: string;
}): Promise<
  { ok: true; slug: string } | { ok: false; error: SlugError | "forbidden" }
> {
  if (!(await isActiveOrganization(input.workspaceId)))
    return { ok: false, error: "forbidden" };
  const role = await roleIn(input.workspaceId, input.actorId);
  if (!role || !canOwnWorkspace(role)) return { ok: false, error: "forbidden" };
  const slug = input.slug.trim().toLowerCase();
  const problem = workspaceSlugProblem(slug);
  if (problem)
    return {
      ok: false,
      error: problem === "format" ? "slug_format" : "slug_reserved",
    };
  try {
    await prisma.workspace.update({
      where: { id: input.workspaceId },
      data: { name: input.name, slug },
    });
    return { ok: true, slug };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "slug_taken" };
    throw e;
  }
}

async function roleIn(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const m = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  });
  return m?.role ?? null;
}

// --- Members and employees ----------------------------------------------------------------------

export type MemberError =
  | "closed"
  | "forbidden"
  | "not_organization"
  | "not_member"
  | "email_taken"
  | "last_owner"
  | "self";

/**
 * Creates an employee account in an organization: a new user (managed by it, with their
 * own personal workspace) who joins with `role`. Only owners and admins, and only with a
 * role they may grant (an admin creates members, never admins or owners).
 */
export async function createEmployee(input: {
  workspaceId: string;
  actorId: string;
  name: string;
  email: string;
  password: string;
  role: WorkspaceRole;
  locale?: string | null;
}): Promise<{ ok: true; userId: string } | { ok: false; error: MemberError }> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: input.workspaceId },
    select: { kind: true, suspendedAt: true },
  });
  if (!workspace || workspace.suspendedAt)
    return { ok: false, error: "forbidden" };
  if (workspace.kind !== "ORGANIZATION")
    return { ok: false, error: "not_organization" };
  const actorRole = await roleIn(input.workspaceId, input.actorId);
  if (!actorRole || !canManageWorkspace(actorRole))
    return { ok: false, error: "forbidden" };
  if (!grantableWorkspaceRoles(actorRole).includes(input.role)) {
    return { ok: false, error: "forbidden" };
  }
  if (!(await mayCreateAccounts(input.actorId)))
    return { ok: false, error: "closed" };

  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  try {
    const userId = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name: input.name,
          passwordHash,
          role: "MEMBER",
          locale: input.locale ?? null,
          managedById: input.workspaceId,
        },
        select: { id: true, name: true, email: true },
      });
      await createPersonalWorkspace(tx, user);
      await tx.workspaceMember.create({
        data: {
          workspaceId: input.workspaceId,
          userId: user.id,
          role: input.role,
        },
      });
      return user.id;
    });
    return { ok: true, userId };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "email_taken" };
    throw e;
  }
}

/**
 * Changes a member's role. The actor must be allowed to act on the member's CURRENT role
 * and to grant the NEW one, cannot change their own role, and the last owner can never be
 * demoted (an organization always has an owner).
 */
export async function changeMemberRole(input: {
  workspaceId: string;
  actorId: string;
  userId: string;
  role: WorkspaceRole;
}): Promise<
  { ok: true; changed: boolean } | { ok: false; error: MemberError }
> {
  if (input.actorId === input.userId) return { ok: false, error: "self" };
  return prisma.$transaction(async (tx) => {
    // Serializes role changes in this workspace, so two owners demoting each other at the
    // same time cannot leave it without an owner.
    await tx.$queryRaw`SELECT 1 FROM "Workspace" WHERE id = ${input.workspaceId} FOR UPDATE`;
    if (!(await isActiveOrganization(input.workspaceId, tx))) {
      return { ok: false, error: "forbidden" } as const;
    }
    const [actor, target] = await Promise.all([
      tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: input.workspaceId,
            userId: input.actorId,
          },
        },
        select: { role: true },
      }),
      tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: input.workspaceId,
            userId: input.userId,
          },
        },
        select: { role: true },
      }),
    ]);
    if (!actor || !canManageWorkspace(actor.role))
      return { ok: false, error: "forbidden" } as const;
    if (!target) return { ok: false, error: "not_member" } as const;
    if (!canActOnWorkspaceMember(actor.role, target.role)) {
      return { ok: false, error: "forbidden" } as const;
    }
    if (!grantableWorkspaceRoles(actor.role).includes(input.role)) {
      return { ok: false, error: "forbidden" } as const;
    }
    if (target.role === input.role)
      return { ok: true, changed: false } as const;
    if (
      target.role === "OWNER" &&
      (await ownerCount(tx, input.workspaceId)) <= 1
    ) {
      return { ok: false, error: "last_owner" } as const;
    }
    await tx.workspaceMember.update({
      where: {
        workspaceId_userId: {
          workspaceId: input.workspaceId,
          userId: input.userId,
        },
      },
      data: { role: input.role },
    });
    return { ok: true, changed: true } as const;
  });
}

function ownerCount(tx: Tx, workspaceId: string): Promise<number> {
  return tx.workspaceMember.count({ where: { workspaceId, role: "OWNER" } });
}

/**
 * Removes someone from an organization (or lets them leave: actor === user). Their explicit
 * memberships of the organization's boards go too, so they keep no back door. The last
 * owner can neither leave nor be removed.
 */
export async function removeMember(input: {
  workspaceId: string;
  actorId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: MemberError }> {
  const leaving = input.actorId === input.userId;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Workspace" WHERE id = ${input.workspaceId} FOR UPDATE`;
    const workspace = await tx.workspace.findUnique({
      where: { id: input.workspaceId },
      select: { kind: true, suspendedAt: true },
    });
    if (!workspace || workspace.suspendedAt)
      return { ok: false, error: "forbidden" } as const;
    if (workspace.kind !== "ORGANIZATION")
      return { ok: false, error: "not_organization" } as const;
    const [actor, target] = await Promise.all([
      tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: input.workspaceId,
            userId: input.actorId,
          },
        },
        select: { role: true },
      }),
      tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: input.workspaceId,
            userId: input.userId,
          },
        },
        select: { role: true },
      }),
    ]);
    if (!actor) return { ok: false, error: "forbidden" } as const;
    if (!target) return { ok: false, error: "not_member" } as const;
    if (!leaving && !canActOnWorkspaceMember(actor.role, target.role)) {
      return { ok: false, error: "forbidden" } as const;
    }
    if (
      target.role === "OWNER" &&
      (await ownerCount(tx, input.workspaceId)) <= 1
    ) {
      return { ok: false, error: "last_owner" } as const;
    }
    await tx.boardMember.deleteMany({
      where: {
        userId: input.userId,
        board: { workspaceId: input.workspaceId },
      },
    });
    await tx.workspaceMember.delete({
      where: {
        workspaceId_userId: {
          workspaceId: input.workspaceId,
          userId: input.userId,
        },
      },
    });
    // Boards they created stay with the organization: an owner takes them over.
    const heir = await tx.workspaceMember.findFirst({
      where: { workspaceId: input.workspaceId, role: "OWNER" },
      orderBy: { addedAt: "asc" },
      select: { userId: true },
    });
    if (heir) {
      await tx.board.updateMany({
        where: { workspaceId: input.workspaceId, ownerId: input.userId },
        data: { ownerId: heir.userId },
      });
    }
    return { ok: true } as const;
  });
}

/**
 * An owner or admin sets a new password for an employee account THIS organization created
 * (User.managedById), never for someone who signed up on their own or belongs to another
 * organization. All their sessions and API tokens are revoked.
 */
export async function resetEmployeePassword(input: {
  workspaceId: string;
  actorId: string;
  userId: string;
  password: string;
}): Promise<{ ok: true } | { ok: false; error: MemberError }> {
  if (input.actorId === input.userId) return { ok: false, error: "self" };
  if (!(await isActiveOrganization(input.workspaceId)))
    return { ok: false, error: "forbidden" };
  const [actor, target] = await Promise.all([
    roleIn(input.workspaceId, input.actorId),
    prisma.user.findFirst({
      where: {
        id: input.userId,
        managedById: input.workspaceId,
        workspaceMemberships: { some: { workspaceId: input.workspaceId } },
      },
      select: {
        workspaceMemberships: {
          where: { workspaceId: input.workspaceId },
          select: { role: true },
        },
      },
    }),
  ]);
  if (!actor || !canManageWorkspace(actor))
    return { ok: false, error: "forbidden" };
  if (!target) return { ok: false, error: "not_member" };
  const targetRole = target.workspaceMemberships[0]?.role;
  if (!targetRole || !canActOnWorkspaceMember(actor, targetRole)) {
    return { ok: false, error: "forbidden" };
  }
  const passwordHash = await hashPassword(input.password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: input.userId }, data: { passwordHash } }),
    prisma.session.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.apiToken.deleteMany({ where: { userId: input.userId } }),
    // A pending invitation (perhaps sent to a mistyped address) stops working too.
    prisma.accountToken.deleteMany({ where: { userId: input.userId } }),
  ]);
  return { ok: true };
}

/**
 * Deletes an organization with all its boards and attachment files (OWNER only). The
 * employees' accounts stay (they become ordinary accounts with their personal workspace);
 * they just lose the organization.
 */
export async function deleteOrganization(input: {
  workspaceId: string;
  actorId: string;
}): Promise<
  { ok: true; boardsDeleted: number } | { ok: false; error: MemberError }
> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: input.workspaceId },
    select: { kind: true, suspendedAt: true },
  });
  if (!workspace || workspace.suspendedAt)
    return { ok: false, error: "forbidden" };
  if (workspace.kind !== "ORGANIZATION")
    return { ok: false, error: "not_organization" };
  const role = await roleIn(input.workspaceId, input.actorId);
  if (!role || !canOwnWorkspace(role)) return { ok: false, error: "forbidden" };
  return { ok: true, boardsDeleted: await purgeWorkspace(input.workspaceId) };
}

/** Deletes a workspace, its boards one by one (with their files) and then the row. */
export async function purgeWorkspace(workspaceId: string): Promise<number> {
  let boardsDeleted = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const boards = await prisma.board.findMany({
      where: { workspaceId },
      select: { id: true },
    });
    for (const b of boards)
      boardsDeleted += await deleteBoardWithAttachments({ id: b.id });
    const { count } = await prisma.workspace.deleteMany({
      where: { id: workspaceId, boards: { none: {} } },
    });
    if (count > 0) return boardsDeleted;
  }
  throw new Error("Could not delete the workspace: new boards keep appearing");
}

// --- Deleting an account ------------------------------------------------------------------------

/**
 * Before an account is deleted: organizations it is the ONLY owner of block the deletion
 * while they have other members (someone must be made owner first, or the organization
 * deleted); the ones where it is alone are deleted; the boards it created in organizations
 * that go on are handed to another owner. Returns the blocking organizations' names. The
 * transaction that finally deletes the account checks again with a lock
 * (soleOwnedOrganizations).
 */
export async function prepareAccountDeletion(
  userId: string,
): Promise<{ ok: true } | { ok: false; organizations: string[] }> {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId, workspace: { kind: "ORGANIZATION" } },
    select: {
      role: true,
      workspace: {
        select: {
          id: true,
          name: true,
          members: {
            where: { userId: { not: userId } },
            select: { userId: true, role: true },
          },
        },
      },
    },
  });
  const blocking = memberships.filter(
    (m) =>
      m.role === "OWNER" &&
      m.workspace.members.length > 0 &&
      !m.workspace.members.some((o) => o.role === "OWNER"),
  );
  if (blocking.length > 0) {
    return { ok: false, organizations: blocking.map((m) => m.workspace.name) };
  }
  for (const m of memberships) {
    if (m.workspace.members.length === 0) {
      await purgeWorkspace(m.workspace.id);
      continue;
    }
    const heir =
      m.workspace.members.find((o) => o.role === "OWNER") ??
      m.workspace.members[0];
    await prisma.board.updateMany({
      where: { workspaceId: m.workspace.id, ownerId: userId },
      data: { ownerId: heir.userId },
    });
    await prisma.boardMember.deleteMany({
      where: { userId, board: { workspaceId: m.workspace.id } },
    });
  }
  return { ok: true };
}

/**
 * Inside the transaction that deletes an account: locks the organizations it owns and
 * returns the names of those where it is still the ONLY owner while others remain. Run
 * there (and not only in prepareAccountDeletion) because two owners leaving at the same
 * time would otherwise each see the other and both go, leaving the organization ownerless;
 * the row lock makes the second wait and then see it is now alone.
 */
export async function soleOwnedOrganizations(
  tx: Tx,
  userId: string,
): Promise<string[]> {
  const owned = await tx.$queryRaw<{ id: string; name: string }[]>`
    SELECT w."id", w."name" FROM "Workspace" w
    JOIN "WorkspaceMember" m ON m."workspaceId" = w."id"
    WHERE m."userId" = ${userId} AND m."role" = 'OWNER' AND w."kind" = 'ORGANIZATION'
    ORDER BY w."id"
    FOR UPDATE OF w`;
  const blocking: string[] = [];
  for (const w of owned) {
    const [owners, others] = await Promise.all([
      tx.workspaceMember.count({
        where: { workspaceId: w.id, role: "OWNER", userId: { not: userId } },
      }),
      tx.workspaceMember.count({
        where: { workspaceId: w.id, userId: { not: userId } },
      }),
    ]);
    if (others > 0 && owners === 0) blocking.push(w.name);
  }
  return blocking;
}

/**
 * Changes a person's handle: the address of their personal workspace (/<handle>/<board>).
 * Same rules as any workspace address; old links with the previous handle stop working
 * (links with a board's id keep working).
 */
export async function updatePersonalHandle(
  userId: string,
  rawSlug: string,
): Promise<{ ok: true; slug: string } | { ok: false; error: SlugError }> {
  const slug = rawSlug.trim().toLowerCase();
  const problem = workspaceSlugProblem(slug);
  if (problem) return { ok: false, error: problem === "format" ? "slug_format" : "slug_reserved" };
  try {
    await prisma.workspace.update({ where: { personalOwnerId: userId }, data: { slug } });
    return { ok: true, slug };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: "slug_taken" };
    throw e;
  }
}
