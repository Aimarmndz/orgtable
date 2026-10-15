import type { Metadata } from "next";
import Link from "next/link";
import { requireOrgSettings } from "@/app/lib/org-settings";
import { canManageWorkspace } from "@/app/lib/roles";
import { PageHeader, SettingsPage } from "@/app/components/settings/page-header";
import { getI18n } from "@/app/i18n/server";
import { RoleList } from "./role-list";
import { loadRoles } from "./data";

// /<slug>/settings/roles: the organization's roles. Every member sees them (knowing what each
// role can do is useful to everyone); only owners and admins create and edit them.

type Params = Promise<{ workspace: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgSettings(slug);
  const { m } = await getI18n();
  return { title: `${m.workspaces.rolesPage.title} · ${workspace.name}` };
}

export default async function RolesPage({ params }: { params: Params }) {
  const { workspace: slug } = await params;
  const { workspace, role } = await requireOrgSettings(slug);
  const [{ m }, { baseCounts, custom }] = await Promise.all([getI18n(), loadRoles(workspace.id)]);
  const t = m.workspaces.rolesPage;
  return (
    <SettingsPage>
      <PageHeader
        address={`/${workspace.slug}/settings/roles`}
        title={t.title}
        description={t.subtitle}
        action={
          canManageWorkspace(role) ? (
            <Link
              href={`/${workspace.slug}/settings/roles/new`}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink shadow-sm transition hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="size-4" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
              {t.new}
            </Link>
          ) : undefined
        }
      />
      <div className="rounded-2xl border border-border bg-surface-2/60 p-2">
        <RoleList slug={workspace.slug} m={m} baseCounts={baseCounts} custom={custom} />
      </div>
      <p className="px-1 text-sm text-ink-muted">{t.rule}</p>
    </SettingsPage>
  );
}
