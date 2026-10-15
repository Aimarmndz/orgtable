import type { Metadata } from "next";
import { LanguagePicker } from "@/app/components/language-picker";
import { PageHeader, SettingsCard, SettingsPage } from "@/app/components/settings/page-header";
import { getI18n } from "@/app/i18n/server";
import { ThemePicker } from "../theme-picker";

// /settings/appearance: theme (this browser) and interface language (the account).

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.settings.nav.appearance };
}

export default async function AppearanceSettingsPage() {
  const { m } = await getI18n();
  const t = m.settings;
  return (
    <SettingsPage>
      <PageHeader address="/settings/appearance" title={t.nav.appearance} description={t.appearance.description} />
      <SettingsCard title={t.appearance.theme} description={t.appearance.themeHint}>
        <ThemePicker />
      </SettingsCard>
      <SettingsCard title={m.common.language.label} description={m.common.language.description}>
        <LanguagePicker variant="cards" />
      </SettingsCard>
    </SettingsPage>
  );
}
