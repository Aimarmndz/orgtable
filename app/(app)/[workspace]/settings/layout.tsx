import Link from "next/link";
import { requireOrgSettings } from "@/app/lib/org-settings";
import { prisma } from "@/app/lib/prisma";
import { personalWorkspaceOf } from "@/app/lib/services/workspaces";
import { SideNav } from "@/app/components/settings/side-nav";
import { NavIcon } from "@/app/components/settings/nav-icons";
import { orgSettingsSections } from "@/app/components/settings/org-nav";
import { BOARD_COLORS, pickBoardColor } from "@/app/lib/colors";
import { initials } from "@/app/lib/initials";
import { getI18n } from "@/app/i18n/server";
import { fmt, plural } from "@/app/i18n/format";

// Settings of an organization (/<slug>/settings/…): a side menu with its sections, one page
// each (DESIGN.md, "Settings and administration"). Members of the organization only, through
// requireOrgSettings: anyone else gets the same 404 as an organization that does not exist.
export default async function WorkspaceSettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireOrgSettings(slug);
  const { workspace } = ctx;
  const [{ intl, m }, personal, members] = await Promise.all([
    getI18n(),
    personalWorkspaceOf(ctx.user.id),
    prisma.workspaceMember.count({ where: { workspaceId: workspace.id } }),
  ]);
  const t = m.workspaces.nav;
  const base = `/${workspace.slug}/settings`;
  const sections = orgSettingsSections(ctx, m, { members });
  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className="shrink-0 md:w-64 md:border-r md:border-border md:bg-surface-2/60 md:px-3.5 md:py-6">
        <Link
          href={`/${workspace.slug}`}
          className="mb-4 hidden items-center gap-2.5 rounded-xl px-2 py-1.5 transition hover:bg-surface md:flex"
        >
          <span
            aria-hidden
            className="grid size-9 shrink-0 place-items-center rounded-lg text-xs font-bold text-white"
            style={{ background: BOARD_COLORS[pickBoardColor(workspace.id)] }}
          >
            {initials(workspace.name)}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display font-bold tracking-tight">{workspace.name}</span>
            <span className="block truncate font-mono text-xs text-ink-muted">
              /{workspace.slug} · {plural(intl, m.workspaces.members.count, members)}
            </span>
          </span>
        </Link>
        <SideNav
          label={t.label}
          mobileIndex={{ href: base, label: m.workspaces.settings.indexTitle }}
          groups={[
            ...sections.map((g) => ({
              label: g.label,
              items: g.items.map((s) => ({ href: s.href, label: s.label, icon: s.icon, badge: s.badge })),
            })),
            {
              label: t.account,
              items: [
                { href: "/settings/profile", label: t.profile, icon: NavIcon.account },
                ...(personal
                  ? [{ href: `/${personal.slug}`, label: t.personalBoards, icon: NavIcon.boards, exact: true }]
                  : []),
              ],
            },
            {
              items: [
                {
                  href: `/${workspace.slug}`,
                  label: fmt(t.backTo, { name: workspace.name }),
                  icon: NavIcon.back,
                  exact: true,
                },
              ],
            },
          ]}
        />
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
