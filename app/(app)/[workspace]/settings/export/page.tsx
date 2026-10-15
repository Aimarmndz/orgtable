import type { Metadata } from "next";
import { requireOrgPermission } from "@/app/lib/org-settings";
import { PageHeader, SettingsCard, SettingsPage } from "@/app/components/settings/page-header";
import { getI18n } from "@/app/i18n/server";

// /<slug>/settings/export: downloading the organization's data, for people with "data.export"
// but not "backups.manage" (those see it on the backups page). docs/backups.md.

type Params = Promise<{ workspace: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgPermission(slug, "data.export");
  const { m } = await getI18n();
  return { title: `${m.backups.export.title} · ${workspace.name}` };
}

export default async function ExportPage({ params }: { params: Params }) {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgPermission(slug, "data.export");
  const { m } = await getI18n();
  const t = m.backups.export;
  return (
    <SettingsPage>
      <PageHeader address={`/${workspace.slug}/settings/export`} title={t.title} description={t.text} />
      <SettingsCard>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/workspaces/${workspace.slug}/export`}
            download
            className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink hover:bg-accent-hover"
          >
            {t.all}
          </a>
          <a
            href={`/api/workspaces/${workspace.slug}/export?attachments=0`}
            download
            className="inline-flex h-10 items-center rounded-lg border border-ink/20 bg-surface px-4 text-sm font-semibold shadow-sm hover:bg-surface-2"
          >
            {t.noFiles}
          </a>
        </div>
      </SettingsCard>
    </SettingsPage>
  );
}
