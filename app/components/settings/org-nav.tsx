import type { ReactNode } from "react";
import type { Messages } from "@/app/i18n/config";
import type { OrgSettingsContext, OrgSettingsCounts } from "@/app/lib/org-settings";
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
  counts: OrgSettingsCounts,
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
        {
          key: "teams",
          href: `${base}/teams`,
          label: t.teams,
          hint: t.hints.teams,
          icon: NavIcon.teams,
          badge: String(counts.teams),
        },
        {
          key: "roles",
          href: `${base}/roles`,
          label: t.roles,
          hint: t.hints.roles,
          icon: NavIcon.roles,
          badge: String(counts.roles),
        },
      ],
    },
    {
      label: t.integrationsGroup,
      items: ctx.permissions.has("integrations.manage")
        ? [
            {
              key: "webhooks",
              href: `${base}/webhooks`,
              label: t.webhooks,
              hint: t.hints.webhooks,
              icon: NavIcon.webhook,
              badge: counts.webhooks ? String(counts.webhooks) : undefined,
            },
            {
              key: "integrations",
              href: `${base}/integrations`,
              label: t.integrations,
              hint: t.hints.integrations,
              icon: NavIcon.plug,
            },
          ]
        : [],
    },
    {
      label: t.dataGroup,
      items: [
        ...(ctx.role === "OWNER" || ctx.role === "ADMIN"
          ? [
              {
                key: "security",
                href: `${base}/security`,
                label: t.security,
                hint: t.hints.security,
                icon: NavIcon.lock,
              },
            ]
          : []),
        ...(ctx.permissions.has("audit.view")
          ? [
              {
                key: "audit",
                href: `${base}/audit`,
                label: t.audit,
                hint: t.hints.audit,
                icon: NavIcon.activity,
              },
            ]
          : []),
      ],
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}
