import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { requireUser, verifySession } from "@/app/lib/dal";
import { prisma } from "@/app/lib/prisma";
import type { WorkspaceRole } from "@/app/lib/roles";
import { permissionsOf, type Permission } from "@/app/lib/permissions";

// THE door of an organization's settings (/<slug>/settings/…). Every page there resolves
// the organization through this function, so the tenant boundary is drawn once:
//
// - The slug is resolved together with the signed-in person's membership, in ONE query.
//   Someone who is not a member gets the same 404 as an address that does not exist, so
//   the settings never reveal which organizations exist.
// - Personal workspaces have no organization settings (their owner uses /settings).
// - Everything the page loads afterwards is filtered by the `workspace.id` returned here,
//   never by an id taken from the URL or a form.
//
// Server Actions do NOT rely on this (a form can be replayed with any id): each service
// checks the actor's membership of the workspace again against the database. See
// docs/authorization.md, "Tenant isolation".

export type OrgSettingsContext = {
  user: Awaited<ReturnType<typeof requireUser>>;
  workspace: {
    id: string;
    slug: string;
    name: string;
    suspendedAt: Date | null;
    suspendedReason: string | null;
    brandColor: string | null;
    logoStoredName: string | null;
    timezone: string | null;
  };
  role: WorkspaceRole;
  // The person's custom role, if they have one, and what they may do (permissions.ts).
  customRole: { id: string; name: string; color: string } | null;
  permissions: ReadonlySet<Permission>;
};

export const requireOrgSettings = cache(async (slug: string): Promise<OrgSettingsContext> => {
  const user = await requireUser();
  const workspace = await prisma.workspace.findFirst({
    where: { slug, kind: "ORGANIZATION", members: { some: { userId: user.id } } },
    select: {
      id: true,
      slug: true,
      name: true,
      suspendedAt: true,
      suspendedReason: true,
      brandColor: true,
      logoStoredName: true,
      timezone: true,
      members: {
        where: { userId: user.id },
        select: {
          role: true,
          customRole: { select: { id: true, name: true, color: true, permissions: true } },
        },
      },
    },
  });
  const member = workspace?.members[0];
  if (!workspace || !member) notFound();
  const { role, customRole } = member;
  return {
    user,
    workspace: {
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      suspendedAt: workspace.suspendedAt,
      suspendedReason: workspace.suspendedReason,
      brandColor: workspace.brandColor,
      logoStoredName: workspace.logoStoredName,
      timezone: workspace.timezone,
    },
    role,
    customRole: customRole ? { id: customRole.id, name: customRole.name, color: customRole.color } : null,
    permissions: permissionsOf(role, customRole?.permissions),
  };
});

/**
 * The same door for a section that needs a permission: without it the page is a 404, the
 * same answer as a section that does not exist.
 */
export async function requireOrgPermission(
  slug: string,
  permission: Permission,
): Promise<OrgSettingsContext> {
  const ctx = await requireOrgSettings(slug);
  if (!ctx.permissions.has(permission)) notFound();
  return ctx;
}

export type OrgSettingsCounts = { members: number; roles: number; teams: number; webhooks: number };

/** Figures shown next to the sections of the menu and the index (one round trip). */
export const orgSettingsCounts = cache(async (workspaceId: string): Promise<OrgSettingsCounts> => {
  const [members, customRoles, teams, webhooks] = await Promise.all([
    prisma.workspaceMember.count({ where: { workspaceId } }),
    prisma.workspaceCustomRole.count({ where: { workspaceId } }),
    prisma.team.count({ where: { workspaceId } }),
    prisma.webhook.count({ where: { workspaceId } }),
  ]);
  return { members, roles: 3 + customRoles, teams, webhooks };
});

/**
 * The same door for route handlers (downloads, exports): no redirect or 404 page, just null
 * when there is no session, the organization is not the person's, or the permission is
 * missing. The handler answers 404 to all of them alike.
 */
export async function orgAccessFromSession(
  slug: string,
  permission: Permission,
): Promise<{ userId: string; workspace: { id: string; slug: string; name: string } } | null> {
  const session = await verifySession();
  if (!session) return null;
  const workspace = await prisma.workspace.findFirst({
    where: { slug, kind: "ORGANIZATION", members: { some: { userId: session.userId } } },
    select: {
      id: true,
      slug: true,
      name: true,
      members: {
        where: { userId: session.userId },
        select: { role: true, customRole: { select: { permissions: true } } },
      },
    },
  });
  const member = workspace?.members[0];
  if (!workspace || !member) return null;
  if (!permissionsOf(member.role, member.customRole?.permissions).has(permission)) return null;
  return { userId: session.userId, workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name } };
}
