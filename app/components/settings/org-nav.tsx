import type { ReactNode } from "react";
import type { Messages } from "@/app/i18n/config";
import type { OrgSettingsContext } from "@/app/lib/org-settings";
import { NavIcon } from "@/app/components/settings/nav-icons";

// The sections of an organization's settings, in the order of the side menu and of the
// index page (/<slug>/settings). One list feeds both, so a section cannot appear in one and
// be missing from the other. A section the person may not open is left out of both (the
// page itself refuses them anyway).

export type OrgSection = {
  key: string;
  href: string;
  label: string;
  hint: string;
  icon: ReactNode;
  badge?: string;
};

export type OrgSectionGroup = { label: string; items: OrgSection[] };

export function orgSettingsSections(
  ctx: OrgSettingsContext,
  m: Messages,
  counts: { members: number },
): OrgSectionGroup[] {
  const t = m.workspaces.nav;
  const base = `/${ctx.workspace.slug}/settings`;
  const groups: OrgSectionGroup[] = [
    {
      label: t.organization,
      items: [
        {
          key: "general",
          href: `${base}/general`,
          label: t.general,
          hint: t.hints.general,
          icon: NavIcon.general,
        },
      ],
    },
    {
      label: t.people,
      items: [
        {
          key: "members",
          href: `${base}/members`,
          label: t.members,
          hint: t.hints.members,
          icon: NavIcon.members,
          badge: String(counts.members),
        },
      ],
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}
