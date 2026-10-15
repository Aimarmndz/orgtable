import type { Metadata } from "next";
import { requireOrgPermission } from "@/app/lib/org-settings";
import { instanceTimeZone } from "@/app/lib/format-date";
import { PageHeader, SettingsCard, SettingsPage } from "@/app/components/settings/page-header";
import { BackupsPanel } from "@/app/components/settings/backups-panel";
import { ImportForm, RunBackupButton } from "@/app/components/settings/backup-forms";
import { getI18n } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";

// /<slug>/settings/backups: the organization's backups, export and import ("backups.manage").
// See docs/backups.md.

type Params = Promise<{ workspace: string }>;

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgPermission(slug, "backups.manage");
  const { m } = await getI18n();
  return { title: `${m.backups.title} · ${workspace.name}` };
}

export default async function OrgBackupsPage({ params }: { params: Params }) {
  const { workspace: slug } = await params;
  const { workspace, permissions } = await requireOrgPermission(slug, "backups.manage");
  const { m } = await getI18n();
  const t = m.backups;
  return (
    <SettingsPage wide>
      <PageHeader
        address={`/${workspace.slug}/settings/backups`}
        title={t.title}
        description={fmt(t.subtitle, { name: workspace.name })}
        action={<RunBackupButton scope={workspace.id} />}
      />
      <BackupsPanel
        workspaceId={workspace.id}
        scope={workspace.id}
        downloadBase={`/api/workspaces/${workspace.slug}/backups`}
        confirm={workspace.slug}
        timeZone={workspace.timezone || instanceTimeZone()}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        {permissions.has("data.export") && (
          <SettingsCard title={t.export.title} description={t.export.text}>
            <div className="flex flex-wrap gap-2">
              <a
                href={`/api/workspaces/${workspace.slug}/export`}
                download
                className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink hover:bg-accent-hover"
              >
                {t.export.all}
              </a>
              <a
                href={`/api/workspaces/${workspace.slug}/export?attachments=0`}
                download
                className="inline-flex h-10 items-center rounded-lg border border-ink/20 bg-surface px-4 text-sm font-semibold shadow-sm hover:bg-surface-2"
              >
                {t.export.noFiles}
              </a>
            </div>
          </SettingsCard>
        )}
        <SettingsCard title={t.import.title} description={t.import.text}>
          <ImportForm slug={workspace.slug} />
        </SettingsCard>
      </div>
    </SettingsPage>
  );
}
