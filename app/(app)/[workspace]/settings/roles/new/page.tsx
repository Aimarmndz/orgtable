import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOrgSettings } from "@/app/lib/org-settings";
import { canManageWorkspace } from "@/app/lib/roles";
import { PageHeader, SettingsPage } from "@/app/components/settings/page-header";
import { RoleEditor } from "@/app/components/workspace/role-editor";
import { getI18n } from "@/app/i18n/server";

// /<slug>/settings/roles/new: create a custom role (owners and admins).

type Params = Promise<{ workspace: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgSettings(slug);
  const { m } = await getI18n();
  return { title: `${m.workspaces.rolesPage.newTitle} · ${workspace.name}` };
}

export default async function NewRolePage({ params }: { params: Params }) {
  const { workspace: slug } = await params;
  const { workspace, role } = await requireOrgSettings(slug);
  if (!canManageWorkspace(role)) notFound();
  const { m } = await getI18n();
  const t = m.workspaces.rolesPage;
  return (
    <SettingsPage>
      <PageHeader address={`/${workspace.slug}/settings/roles/new`} title={t.newTitle} description={t.rule} />
      <RoleEditor
        workspaceId={workspace.id}
        role={{ name: "", color: "blue", description: null, permissions: ["boards.create"] }}
      />
    </SettingsPage>
  );
}
