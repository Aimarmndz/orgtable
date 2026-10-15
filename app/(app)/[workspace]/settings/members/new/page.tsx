import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOrgSettings } from "@/app/lib/org-settings";
import { canManageWorkspace, grantableWorkspaceRoles } from "@/app/lib/roles";
import { isMailEnabled } from "@/app/lib/mail/config";
import { CreateEmployeeForm } from "@/app/components/workspace/forms";
import { PageHeader, SettingsPage } from "@/app/components/settings/page-header";
import { getI18n } from "@/app/i18n/server";

// /<slug>/settings/members/new: create an employee account (owners and admins). Its own
// page instead of a form at the bottom of the members list that the button scrolled to.

type Params = Promise<{ workspace: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgSettings(slug);
  const { m } = await getI18n();
  return { title: `${m.workspaces.members.createTitle} · ${workspace.name}` };
}

export default async function NewEmployeePage({ params }: { params: Params }) {
  const { workspace: slug } = await params;
  const { workspace, role } = await requireOrgSettings(slug);
  if (!canManageWorkspace(role)) notFound();
  const { m } = await getI18n();
  return (
    <SettingsPage>
      <PageHeader
        address={`/${workspace.slug}/settings/members/new`}
        title={m.workspaces.members.createTitle}
        description={isMailEnabled() ? m.workspaces.members.createTextInvite : m.workspaces.members.createText}
      />
      <CreateEmployeeForm
        workspaceId={workspace.id}
        roles={grantableWorkspaceRoles(role)}
        invite={isMailEnabled()}
        heading={false}
      />
    </SettingsPage>
  );
}
