import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireUser } from "@/app/lib/dal";
import { personalWorkspaceOf } from "@/app/lib/services/workspaces";
import { publicHost } from "@/app/lib/mail/config";
import { HandleForm } from "@/app/components/workspace/forms";
import { PageHeader, SettingsCard, SettingsPage } from "@/app/components/settings/page-header";
import { getI18n } from "@/app/i18n/server";
import { AvatarForm, ProfileForm } from "../account-forms";

// /settings/profile: photo, name, email and the handle of the personal boards.

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.settings.nav.profile };
}

export default async function ProfileSettingsPage() {
  const user = await requireUser();
  const [{ m }, personal, h] = await Promise.all([getI18n(), personalWorkspaceOf(user.id), headers()]);
  const t = m.settings;
  return (
    <SettingsPage>
      <PageHeader address="/settings/profile" title={t.nav.profile} description={t.profile.description} />
      <SettingsCard title={t.profile.photoTitle}>
        <AvatarForm user={{ id: user.id, name: user.name, avatarStoredName: user.avatarStoredName }} />
      </SettingsCard>
      <SettingsCard title={t.profile.cardTitle}>
        <ProfileForm name={user.name} email={user.email} />
      </SettingsCard>
      {personal && (
        <SettingsCard title={m.workspaces.handle.label}>
          <HandleForm slug={personal.slug} host={publicHost(h.get("host"))} />
        </SettingsCard>
      )}
    </SettingsPage>
  );
}
