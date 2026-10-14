import { notFound } from "next/navigation";
import { requireUser } from "@/app/lib/dal";
import { getWorkspaceForUser } from "@/app/lib/queries";
import { personalWorkspaceOf } from "@/app/lib/services/workspaces";
import { SideNav } from "@/app/components/settings/side-nav";
import { NavIcon } from "@/app/components/settings/nav-icons";
import { getI18n } from "@/app/i18n/server";

// Settings of an organization (/<slug>/settings/…): a side menu with its sections and the
// person's own account, like the administration panel (DESIGN.md, "Settings and
// administration"). Members of the organization only; anyone else gets the same 404 as a
// workspace that does not exist.
export default async function WorkspaceSettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(slug, user.id);
  if (!workspace || !workspace.role || workspace.kind !== "ORGANIZATION") notFound();
  const [{ m }, personal] = await Promise.all([getI18n(), personalWorkspaceOf(user.id)]);
  const t = m.workspaces.nav;
  const base = `/${workspace.slug}/settings`;
  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className="shrink-0 border-b border-border bg-surface-2/60 px-3 py-3 md:w-64 md:border-b-0 md:border-r md:px-3.5 md:py-6">
        <p className="hidden truncate px-3 pb-4 font-display text-lg font-bold tracking-tight md:block">
          {workspace.name}
        </p>
        <SideNav
          label={t.label}
          groups={[
            {
              label: t.organization,
              items: [
                { href: `/${workspace.slug}`, label: t.boards, icon: NavIcon.boards, exact: true },
                { href: base, label: t.members, icon: NavIcon.members, exact: true },
                { href: `${base}/general`, label: t.general, icon: NavIcon.general },
              ],
            },
            {
              label: t.account,
              items: [
                { href: "/settings", label: t.profile, icon: NavIcon.account },
                ...(personal
                  ? [{ href: `/${personal.slug}`, label: t.personalBoards, icon: NavIcon.boards, exact: true }]
                  : []),
              ],
            },
          ]}
        />
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
