import type { Metadata } from "next";
import Link from "next/link";
import { requireOrgSettings } from "@/app/lib/org-settings";
import { prisma } from "@/app/lib/prisma";
import { orgSettingsSections } from "@/app/components/settings/org-nav";
import { NavIcon } from "@/app/components/settings/nav-icons";
import { PageHeader, SettingsPage } from "@/app/components/settings/page-header";
import { getI18n } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";

// Index of an organization's settings (/<slug>/settings): every section as a row with what
// it is for. On a phone it is the way in (the side menu becomes a "back" link on the other
// pages); on a computer, an overview next to the menu.

type Params = Promise<{ workspace: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgSettings(slug);
  const { m } = await getI18n();
  return { title: fmt(m.workspaces.settings.metaTitle, { name: workspace.name }) };
}

export default async function OrgSettingsIndexPage({ params }: { params: Params }) {
  const { workspace: slug } = await params;
  const ctx = await requireOrgSettings(slug);
  const [{ m }, members] = await Promise.all([
    getI18n(),
    prisma.workspaceMember.count({ where: { workspaceId: ctx.workspace.id } }),
  ]);
  const groups = orgSettingsSections(ctx, m, { members });
  return (
    <SettingsPage>
      <PageHeader
        address={`/${ctx.workspace.slug}/settings`}
        title={m.workspaces.settings.indexTitle}
        description={fmt(m.workspaces.settings.indexText, {
          name: ctx.workspace.name,
          role: m.workspaces.roles[ctx.role],
        })}
      />
      {groups.map((g) => (
        <section key={g.label} aria-label={g.label}>
          <h2 className="px-1 pb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
            {g.label}
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
            {g.items.map((s) => (
              <li key={s.key}>
                <Link
                  href={s.href}
                  className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                >
                  <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-muted">
                    {s.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{s.label}</span>
                    <span className="block truncate text-sm text-ink-muted">{s.hint}</span>
                  </span>
                  {s.badge && <span className="font-mono text-sm text-ink-muted">{s.badge}</span>}
                  <span aria-hidden className="text-ink-muted">
                    {NavIcon.chevron}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </SettingsPage>
  );
}
