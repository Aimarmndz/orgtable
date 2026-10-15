import type { Metadata } from "next";
import Link from "next/link";
import { requireOrgSettings } from "@/app/lib/org-settings";
import { listTeams } from "@/app/lib/services/teams";
import { BOARD_COLORS, pickBoardColor, type BoardColor } from "@/app/lib/colors";
import { initials } from "@/app/lib/initials";
import { PageHeader, SettingsPage } from "@/app/components/settings/page-header";
import { getI18n } from "@/app/i18n/server";
import { plural } from "@/app/i18n/format";

// /<slug>/settings/teams: the organization's teams as cards. Every member sees them; people
// with "people.teams" create and change them (docs/teams.md).

type Params = Promise<{ workspace: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgSettings(slug);
  const { m } = await getI18n();
  return { title: `${m.workspaces.teams.title} · ${workspace.name}` };
}

export default async function TeamsPage({ params }: { params: Params }) {
  const { workspace: slug } = await params;
  const { workspace, permissions } = await requireOrgSettings(slug);
  const [{ intl, m }, teams] = await Promise.all([getI18n(), listTeams(workspace.id)]);
  const t = m.workspaces.teams;
  return (
    <SettingsPage wide>
      <PageHeader
        address={`/${workspace.slug}/settings/teams`}
        title={t.title}
        description={t.subtitle}
        action={
          permissions.has("people.teams") ? (
            <Link
              href={`/${workspace.slug}/settings/teams/new`}
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
      {teams.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center text-sm text-ink-muted">
          {t.empty}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {teams.map((team) => (
            <li key={team.id}>
              <Link
                href={`/${workspace.slug}/settings/teams/${team.id}`}
                className="flex h-full flex-col gap-3 rounded-2xl border border-border bg-surface p-5 transition hover:border-ink/25 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-accent"
              >
                <span className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="size-3 rounded-full"
                    style={{ background: BOARD_COLORS[(team.color in BOARD_COLORS ? team.color : "teal") as BoardColor] }}
                  />
                  <span className="truncate font-display text-lg font-bold tracking-tight">{team.name}</span>
                </span>
                {team.description && <span className="line-clamp-2 text-sm text-ink-muted">{team.description}</span>}
                <span className="mt-auto flex items-center justify-between gap-2">
                  <span className="text-sm text-ink-muted">
                    {plural(intl, t.people, team._count.members)} · {plural(intl, t.boards, team._count.boards)}
                  </span>
                  <span className="flex -space-x-2">
                    {team.members.slice(0, 4).map(({ member }) => (
                      <span
                        key={member.user.id}
                        title={member.user.name}
                        className="grid size-7 place-items-center rounded-full text-[10px] font-bold text-white ring-2 ring-surface"
                        style={{ background: BOARD_COLORS[pickBoardColor(member.user.id)] }}
                      >
                        {initials(member.user.name)}
                      </span>
                    ))}
                    {team._count.members > 4 && (
                      <span className="grid size-7 place-items-center rounded-full bg-surface-2 text-[10px] font-bold text-ink ring-2 ring-surface">
                        +{team._count.members - 4}
                      </span>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="px-1 text-sm text-ink-muted">{t.rule}</p>
    </SettingsPage>
  );
}
