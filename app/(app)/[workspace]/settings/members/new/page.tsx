import type { Metadata } from "next";
import { requireOrgPermission } from "@/app/lib/org-settings";
import { canManageWorkspace, grantableWorkspaceRoles } from "@/app/lib/roles";
import { listCustomRoles } from "@/app/lib/services/roles";
import { roleOptions } from "@/app/components/workspace/role-options";
import { isMailEnabled } from "@/app/lib/mail/config";
import { CreateEmployeeForm } from "@/app/components/workspace/forms";
import { PageHeader, SettingsPage } from "@/app/components/settings/page-header";
import { getI18n } from "@/app/i18n/server";

// /<slug>/settings/members/new: create an employee account. Its own page instead of a form
// at the bottom of the members list that the button scrolled to.

type Params = Promise<{ workspace: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgPermission(slug, "people.invite");
  const { m } = await getI18n();
  return { title: `${m.workspaces.members.createTitle} · ${workspace.name}` };
}

export default async function NewEmployeePage({ params }: { params: Params }) {
  const { workspace: slug } = await params;
  // "people.invite": owners and admins, or a custom role that holds it (plain members only).
  const { workspace, role } = await requireOrgPermission(slug, "people.invite");
  const manager = canManageWorkspace(role);
  const [{ m }, customRoles] = await Promise.all([getI18n(), manager ? listCustomRoles(workspace.id) : []]);
  return (
    <SettingsPage>
      <PageHeader
        address={`/${workspace.slug}/settings/members/new`}
        title={m.workspaces.members.createTitle}
        description={isMailEnabled() ? m.workspaces.members.createTextInvite : m.workspaces.members.createText}
      />
      <CreateEmployeeForm
        workspaceId={workspace.id}
        roles={roleOptions(m, manager ? grantableWorkspaceRoles(role) : ["MEMBER"], customRoles)}
        invite={isMailEnabled()}
        heading={false}
      />
    </SettingsPage>
  );
}
