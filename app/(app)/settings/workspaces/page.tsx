import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/app/lib/dal";
import { getWorkspacesForUser } from "@/app/lib/queries";
import { BOARD_COLORS, pickBoardColor } from "@/app/lib/colors";
import { initials } from "@/app/lib/initials";
import { CreateOrganizationForm } from "@/app/components/workspace/forms";
import { PageHeader, SettingsCard, SettingsPage } from "@/app/components/settings/page-header";
import { getI18n } from "@/app/i18n/server";

// /settings/workspaces: the person's own workspace and the organizations they belong to,
// with the way into each one's settings, plus creating a new organization.

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.settings.nav.workspaces };
}

const OUTLINE =
  "inline-flex h-9 items-center rounded-lg border border-ink/20 bg-surface px-3 text-sm font-semibold text-ink shadow-sm transition hover:bg-surface-2";

export default async function WorkspacesSettingsPage() {
  const user = await requireUser();
  const [{ m }, workspaces] = await Promise.all([getI18n(), getWorkspacesForUser(user.id)]);
  const t = m.settings.workspaces;
  return (
    <SettingsPage>
      <PageHeader address="/settings/workspaces" title={m.settings.nav.workspaces} description={t.description} />
      <SettingsCard title={t.listTitle}>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {workspaces.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-3 bg-surface px-4 py-3">
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-lg text-xs font-bold text-white"
                style={{ background: BOARD_COLORS[pickBoardColor(w.id)] }}
              >
                {initials(w.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{w.name}</p>
                <p className="truncate font-mono text-xs text-ink-muted">
                  /{w.slug} · {m.workspaces.kind[w.kind]} · {m.workspaces.roles[w.role]}
                  {w.suspendedAt ? ` · ${t.suspended}` : ""}
                </p>
              </div>
              <div className="flex gap-2">
                <Link href={`/${w.slug}`} className={OUTLINE}>
                  {t.open}
                </Link>
                {w.kind === "ORGANIZATION" && (
                  <Link href={`/${w.slug}/settings`} className={OUTLINE}>
                    {t.settings}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      </SettingsCard>
      <SettingsCard title={m.workspaces.createOrg.toggle}>
        <CreateOrganizationForm />
      </SettingsCard>
    </SettingsPage>
  );
}
