import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgSettings } from "@/app/lib/org-settings";
import { prisma } from "@/app/lib/prisma";
import { canManageWorkspace } from "@/app/lib/roles";
import { MEMBER_PERMISSIONS, PERMISSIONS } from "@/app/lib/permissions";
import { deleteRoleAction, duplicateRoleAction } from "@/app/lib/actions/roles";
import { PageHeader } from "@/app/components/settings/page-header";
import { RoleEditor } from "@/app/components/workspace/role-editor";
import { Button } from "@/app/components/ui/button";
import { getI18n } from "@/app/i18n/server";
import { plural } from "@/app/i18n/format";
import { BASE_ROLE_SLUGS, RoleList } from "../role-list";
import { loadRoles } from "../data";

// /<slug>/settings/roles/<id>: one role. A base role (owner, admin, member) is shown locked;
// a custom role is edited by owners and admins and shown read-only to everyone else. The
// custom role is looked up by { workspaceId, id }: an id of another organization is a 404.

type Params = Promise<{ workspace: string; id: string }>;

async function findRole(workspaceId: string, id: string) {
  return prisma.workspaceCustomRole.findUnique({
    where: { workspaceId_id: { workspaceId, id } },
    select: {
      id: true,
      name: true,
      color: true,
      description: true,
      permissions: true,
      members: { select: { user: { select: { name: true } } }, take: 5 },
      _count: { select: { members: true } },
    },
  });
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspace: slug, id } = await params;
  const { workspace } = await requireOrgSettings(slug);
  const { m } = await getI18n();
  const base = BASE_ROLE_SLUGS[id];
  const name = base ? m.workspaces.roles[base] : (await findRole(workspace.id, id))?.name;
  return { title: `${name ?? m.workspaces.rolesPage.title} · ${workspace.name}` };
}

export default async function RolePage({ params }: { params: Params }) {
  const { workspace: slug, id } = await params;
  const { workspace, role: myRole } = await requireOrgSettings(slug);
  const [{ intl, m }, { baseCounts, custom }] = await Promise.all([getI18n(), loadRoles(workspace.id)]);
  const t = m.workspaces.rolesPage;
  const base = BASE_ROLE_SLUGS[id];
  const custom1 = base ? null : await findRole(workspace.id, id);
  if (!base && !custom1) notFound();
  const editable = !base && canManageWorkspace(myRole);
  const holders = base ? baseCounts[base] : (custom1?._count.members ?? 0);

  const title = base ? m.workspaces.roles[base] : custom1!.name;
  const description = base
    ? m.workspaces.roleHelp[base]
    : holders > 0
      ? `${plural(intl, t.holders, holders)} ${custom1!.members.map((x) => x.user.name).join(", ")}${holders > 5 ? "…" : "."}`
      : t.holdersNone;

  return (
    <div className="mx-auto flex w-full max-w-6xl gap-8 p-5 sm:p-8 lg:p-10">
      <aside className="hidden w-64 shrink-0 lg:block">
        <RoleList slug={workspace.slug} m={m} baseCounts={baseCounts} custom={custom} current={id} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <Link
          href={`/${workspace.slug}/settings/roles`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-ink-muted hover:text-ink lg:hidden"
        >
          ‹ {t.back}
        </Link>
        <PageHeader
          address={`/${workspace.slug}/settings/roles/${id}`}
          title={title}
          description={description}
          action={
            editable ? (
              <div className="flex flex-wrap gap-2">
                <form action={duplicateRoleAction}>
                  <input type="hidden" name="workspaceId" value={workspace.id} />
                  <input type="hidden" name="roleId" value={custom1!.id} />
                  <Button type="submit" variant="outline" className="h-10">
                    {t.duplicate}
                  </Button>
                </form>
                <details className="relative">
                  <summary className="inline-flex h-10 cursor-pointer list-none items-center rounded-lg border border-danger/40 bg-surface px-4 text-sm font-medium text-danger shadow-sm hover:bg-danger/5 [&::-webkit-details-marker]:hidden">
                    {t.delete}
                  </summary>
                  <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-border bg-surface p-4 shadow-[0_16px_40px_-16px_oklch(0.27_0.022_52/0.45)]">
                    <p className="text-sm text-ink-muted">{t.deleteConfirm}</p>
                    <form action={deleteRoleAction} className="mt-3">
                      <input type="hidden" name="workspaceId" value={workspace.id} />
                      <input type="hidden" name="roleId" value={custom1!.id} />
                      <Button type="submit" variant="dangerSolid" className="w-full">
                        {t.deleteSubmit}
                      </Button>
                    </form>
                  </div>
                </details>
              </div>
            ) : undefined
          }
        />
        <RoleEditor
          key={custom1?.id ?? id}
          workspaceId={workspace.id}
          readOnly={!editable}
          identity={!base}
          lockedNote={base ? t.locked : editable ? undefined : t.readOnly}
          role={
            base
              ? {
                  name: m.workspaces.roles[base],
                  color: "blue",
                  description: m.workspaces.roleHelp[base],
                  permissions: base === "MEMBER" ? [...MEMBER_PERMISSIONS] : [...PERMISSIONS],
                }
              : {
                  id: custom1!.id,
                  name: custom1!.name,
                  color: custom1!.color,
                  description: custom1!.description,
                  permissions: custom1!.permissions,
                }
          }
        />
      </div>
    </div>
  );
}
