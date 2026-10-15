import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/app/lib/dal";
import { prisma } from "@/app/lib/prisma";
import type { WorkspaceRole } from "@/app/lib/roles";

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
  };
  role: WorkspaceRole;
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
      members: { where: { userId: user.id }, select: { role: true } },
    },
  });
  const role = workspace?.members[0]?.role;
  if (!workspace || !role) notFound();
  return {
    user,
    workspace: {
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      suspendedAt: workspace.suspendedAt,
      suspendedReason: workspace.suspendedReason,
    },
    role,
  };
});
