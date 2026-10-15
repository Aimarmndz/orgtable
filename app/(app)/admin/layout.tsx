import { requireAdmin } from "@/app/lib/dal";
import { SideNav } from "@/app/components/settings/side-nav";
import { NavIcon } from "@/app/components/settings/nav-icons";
import { getI18n } from "@/app/i18n/server";

// The instance administrator's panel (/admin/…): a dark side menu that sets it apart from
// the rest of the app, so it is always clear one is acting on the whole service (DESIGN.md,
// "Settings and administration"). Every page checks requireAdmin again.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const { m } = await getI18n();
  const t = m.admin.nav;
  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className="shrink-0 bg-[oklch(0.22_0.02_50)] px-3 py-3 text-white md:w-60 md:px-3.5 md:py-6">
        <p className="hidden items-center gap-2 px-3 pb-5 md:flex">
          <span className="font-display text-lg font-bold tracking-tight">{t.label}</span>
          <span className="rounded-full bg-[oklch(0.68_0.115_45)] px-2 py-0.5 text-[10px] font-bold tracking-wider text-[oklch(0.22_0.02_50)]">
            ADMIN
          </span>
        </p>
        <SideNav
          dark
          label={t.label}
          groups={[
            {
              items: [
                { href: "/admin/workspaces", label: t.workspaces, icon: NavIcon.overview },
                { href: "/admin/users", label: t.users, icon: NavIcon.account },
                { href: "/admin/audit", label: t.audit, icon: NavIcon.shield },
                { href: "/admin/instance", label: t.instance, icon: NavIcon.instance },
                { href: "/admin/backups", label: t.backups, icon: NavIcon.database },
              ],
            },
            { items: [{ href: "/boards", label: t.back, icon: NavIcon.back }] },
          ]}
        />
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
