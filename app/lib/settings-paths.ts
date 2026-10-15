// Addresses of the pages of one's own settings (/settings/<section>). Before they were
// pages, the sections were fragments of a single /settings page (/settings#data); old links
// and bookmarks with a fragment still land on the right page (app/(app)/settings/page.tsx).

export const ACCOUNT_SETTINGS = {
  profile: "/settings/profile",
  security: "/settings/security",
  tokens: "/settings/tokens",
  appearance: "/settings/appearance",
  workspaces: "/settings/workspaces",
  data: "/settings/data",
} as const;

export type AccountSettingsSection = keyof typeof ACCOUNT_SETTINGS;

const LEGACY_FRAGMENTS: Record<string, AccountSettingsSection> = {
  profile: "profile",
  security: "security",
  api: "tokens",
  appearance: "appearance",
  data: "data",
  about: "data",
};

/** The page an old /settings#<fragment> link meant (the profile when unknown). */
export function settingsPathForFragment(fragment: string): string {
  const key = LEGACY_FRAGMENTS[fragment.replace(/^#/, "")] ?? "profile";
  return ACCOUNT_SETTINGS[key];
}
