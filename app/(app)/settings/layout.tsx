import { requireUser } from "@/app/lib/dal";
import { SideNav } from "@/app/components/settings/side-nav";
import { NavIcon } from "@/app/components/settings/nav-icons";
import { ACCOUNT_SETTINGS } from "@/app/lib/settings-paths";
import { getI18n } from "@/app/i18n/server";

// One's own settings (/settings/<section>): one page per section with a side menu, the
// same pattern as an organization's settings and the administration (DESIGN.md, "Settings
// and administration"). Each section is its own address, so the menu loads a page instead
// of scrolling down a long one.

export default async function AccountSettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { m } = await getI18n();
  const t = m.settings.nav;
  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className="shrink-0 border-b border-border bg-surface-2/60 px-3 py-3 md:w-64 md:border-b-0 md:border-r md:px-3.5 md:py-6">
        <div className="hidden px-3 pb-4 md:block">
          <p className="font-display text-lg font-bold tracking-tight">{m.settings.title}</p>
          <p className="truncate text-sm text-ink-muted" title={user.email}>
            {user.name}
          </p>
        </div>
        <SideNav
          label={m.settings.navLabel}
          groups={[
            {
              label: t.account,
              items: [
                { href: ACCOUNT_SETTINGS.profile, label: t.profile, icon: NavIcon.account },
                { href: ACCOUNT_SETTINGS.security, label: t.security, icon: NavIcon.lock },
                { href: ACCOUNT_SETTINGS.appearance, label: t.appearance, icon: NavIcon.appearance },
              ],
            },
            {
              label: t.workspacesGroup,
              items: [
                { href: ACCOUNT_SETTINGS.workspaces, label: t.workspaces, icon: NavIcon.building },
                { href: ACCOUNT_SETTINGS.tokens, label: t.tokens, icon: NavIcon.code },
              ],
            },
            {
              label: t.dataGroup,
              items: [{ href: ACCOUNT_SETTINGS.data, label: t.data, icon: NavIcon.download }],
            },
            {
              items: [
                ...(user.role === "ADMIN"
                  ? [{ href: "/admin/workspaces", label: t.admin, icon: NavIcon.shield, badge: "ADMIN" }]
                  : []),
                { href: "/boards", label: t.back, icon: NavIcon.back, exact: true },
              ],
            },
          ]}
        />
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
