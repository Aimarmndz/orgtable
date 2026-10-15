import type { Metadata } from "next";
import { requireAdmin } from "@/app/lib/dal";
import { instanceTimeZone } from "@/app/lib/format-date";
import { PageHeader, SettingsPage } from "@/app/components/settings/page-header";
import { BackupsPanel } from "@/app/components/settings/backups-panel";
import { RunBackupButton } from "@/app/components/settings/backup-forms";
import { getI18n } from "@/app/i18n/server";

// /admin/backups: backups of the whole instance (accounts, organizations, boards, files), for
// its administrator. Restoring one replaces everything. See docs/backups.md, "Instance".

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.backups.instanceTitle };
}

export default async function AdminBackupsPage() {
  await requireAdmin();
  const { m } = await getI18n();
  return (
    <SettingsPage wide>
      <PageHeader
        address="/admin/backups"
        title={m.backups.instanceTitle}
        description={m.backups.instanceSubtitle}
        action={<RunBackupButton scope="instance" />}
      />
      <BackupsPanel workspaceId={null} scope="instance" downloadBase="/api/admin/backups" confirm="instance" timeZone={instanceTimeZone()} />
    </SettingsPage>
  );
}
