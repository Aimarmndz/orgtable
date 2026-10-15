import type { Metadata } from "next";
import { requireOrgPermission } from "@/app/lib/org-settings";
import { PageHeader, SettingsCard, SettingsPage } from "@/app/components/settings/page-header";
import { TeamForm } from "@/app/components/workspace/team-forms";
import { getI18n } from "@/app/i18n/server";

// /<slug>/settings/teams/new: create a team ("people.teams").

type Params = Promise<{ workspace: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgPermission(slug, "people.teams");
  const { m } = await getI18n();
  return { title: `${m.workspaces.teams.new} · ${workspace.name}` };
}

export default async function NewTeamPage({ params }: { params: Params }) {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgPermission(slug, "people.teams");
  const { m } = await getI18n();
  const t = m.workspaces.teams;
  return (
    <SettingsPage>
      <PageHeader address={`/${workspace.slug}/settings/teams/new`} title={t.new} description={t.rule} />
      <SettingsCard>
        <TeamForm workspaceId={workspace.id} />
      </SettingsCard>
    </SettingsPage>
  );
}
