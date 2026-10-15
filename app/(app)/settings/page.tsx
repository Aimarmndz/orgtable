import type { Metadata } from "next";
import Link from "next/link";
import { ACCOUNT_SETTINGS } from "@/app/lib/settings-paths";
import { getI18n } from "@/app/i18n/server";
import { LegacySettingsRedirect } from "./legacy-redirect";

// /settings has no content of its own: it opens the profile, or the section an old
// /settings#<section> link pointed at (see app/lib/settings-paths.ts).

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.settings.meta.title, description: m.settings.meta.description };
}

export default async function SettingsIndexPage() {
  const { m } = await getI18n();
  return (
    <div className="p-8 text-sm text-ink-muted">
      <LegacySettingsRedirect />
      <Link href={ACCOUNT_SETTINGS.profile} className="text-accent underline-offset-2 hover:underline">
        {m.settings.nav.profile}
      </Link>
    </div>
  );
}
