import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgSettings } from "@/app/lib/org-settings";
import { prisma } from "@/app/lib/prisma";
import { accessibleBoardsWhere } from "@/app/lib/access";
import {
  addTeamMemberAction,
  deleteTeamAction,
  removeTeamBoardAction,
  removeTeamMemberAction,
} from "@/app/lib/actions/teams";
import { BOARD_COLORS, pickBoardColor } from "@/app/lib/colors";
import { initials } from "@/app/lib/initials";
import { boardPath } from "@/app/lib/slugs";
import { PageHeader, SettingsCard, SettingsPage } from "@/app/components/settings/page-header";
import { TeamBoardForm, TeamForm } from "@/app/components/workspace/team-forms";
import { SELECT } from "@/app/components/settings/form-bits";
import { Button } from "@/app/components/ui/button";
import { getI18n } from "@/app/i18n/server";
import { fmt, plural } from "@/app/i18n/format";

// /<slug>/settings/teams/<id>: one team, its people and the boards it opens. Looked up by
// { workspaceId, id }: a team of another organization is a 404. The boards offered are only
// those the person can open, as the service requires.

type Params = Promise<{ workspace: string; id: string }>;

async function findTeam(workspaceId: string, id: string) {
  return prisma.team.findUnique({
    where: { workspaceId_id: { workspaceId, id } },
    select: {
      id: true,
      name: true,
      color: true,
      description: true,
      members: {
        orderBy: { addedAt: "asc" },
        select: { member: { select: { role: true, user: { select: { id: true, name: true, email: true } } } } },
      },
      boards: {
        orderBy: { addedAt: "asc" },
        select: { role: true, board: { select: { id: true, title: true, slug: true, visibility: true } } },
      },
    },
  });
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspace: slug, id } = await params;
  const { workspace } = await requireOrgSettings(slug);
  const team = await findTeam(workspace.id, id);
  const { m } = await getI18n();
  return { title: `${team?.name ?? m.workspaces.teams.title} · ${workspace.name}` };
}

export default async function TeamPage({ params }: { params: Params }) {
  const { workspace: slug, id } = await params;
  const { user, workspace, permissions } = await requireOrgSettings(slug);
  const team = await findTeam(workspace.id, id);
  if (!team) notFound();
  const manage = permissions.has("people.teams");
  const inTeam = new Set(team.members.map((x) => x.member.user.id));
  const hasBoard = new Set(team.boards.map((x) => x.board.id));
  const [{ intl, m }, people, boards] = await Promise.all([
    getI18n(),
    manage
      ? prisma.workspaceMember.findMany({
          where: { workspaceId: workspace.id },
          orderBy: { user: { name: "asc" } },
          select: { user: { select: { id: true, name: true } } },
        })
      : [],
    manage
      ? prisma.board.findMany({
          where: { AND: [{ workspaceId: workspace.id }, accessibleBoardsWhere(user.id)] },
          orderBy: { title: "asc" },
          select: { id: true, title: true },
        })
      : [],
  ]);
  const t = m.workspaces.teams;
  const addable = people.filter((p) => !inTeam.has(p.user.id));
  const offerBoards = boards.filter((b) => !hasBoard.has(b.id));

  return (
    <SettingsPage wide>
      <Link href={`/${workspace.slug}/settings/teams`} className="text-sm font-semibold text-ink-muted hover:text-ink">
        ‹ {t.back}
      </Link>
      <PageHeader
        address={`/${workspace.slug}/settings/teams/${team.id}`}
        title={team.name}
        description={`${team.description ? `${team.description} · ` : ""}${plural(intl, t.people, team.members.length)} · ${plural(intl, t.boards, team.boards.length)}`}
      />
      {!manage && <p className="text-sm text-ink-muted">{t.readOnly}</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        <SettingsCard title={t.membersTitle}>
          {team.members.length === 0 ? (
            <p className="text-sm text-ink-muted">{t.noMembers}</p>
          ) : (
            <ul className="divide-y divide-border">
              {team.members.map(({ member }) => (
                <li key={member.user.id} className="flex items-center gap-3 py-2.5">
                  <span
                    aria-hidden
                    className="grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
                    style={{ background: BOARD_COLORS[pickBoardColor(member.user.id)] }}
                  >
                    {initials(member.user.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{member.user.name}</span>
                    <span className="block truncate text-xs text-ink-muted">{m.workspaces.roles[member.role]}</span>
                  </span>
                  {manage && (
                    <form action={removeTeamMemberAction}>
                      <input type="hidden" name="workspaceId" value={workspace.id} />
                      <input type="hidden" name="teamId" value={team.id} />
                      <input type="hidden" name="userId" value={member.user.id} />
                      <Button
                        type="submit"
                        variant="dangerOutline"
                        className="h-8 px-3"
                        aria-label={fmt(t.removePerson, { name: member.user.name })}
                      >
                        {t.remove}
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          {manage && addable.length > 0 && (
            <form action={addTeamMemberAction} className="mt-4 flex gap-2 border-t border-border pt-4">
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <input type="hidden" name="teamId" value={team.id} />
              <select name="userId" required aria-label={t.pickPerson} className={`${SELECT} mt-0 min-w-0 flex-1`}>
                <option value="">{t.pickPerson}</option>
                {addable.map((p) => (
                  <option key={p.user.id} value={p.user.id}>
                    {p.user.name}
                  </option>
                ))}
              </select>
              <Button type="submit" className="h-10">
                {t.addPerson}
              </Button>
            </form>
          )}
        </SettingsCard>

        <SettingsCard title={t.boardsTitle}>
          {team.boards.length === 0 ? (
            <p className="text-sm text-ink-muted">{t.noBoards}</p>
          ) : (
            <ul className="divide-y divide-border">
              {team.boards.map(({ board, role }) => (
                <li key={board.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-[1_1_10rem]">
                    <Link href={boardPath(workspace.slug, board.slug)} className="block truncate text-sm font-semibold hover:underline">
                      {board.title}
                    </Link>
                    <span className="block truncate font-mono text-xs text-ink-muted">
                      {boardPath(workspace.slug, board.slug)}
                      {board.visibility === "PRIVATE" ? ` · ${t.private}` : ""}
                    </span>
                  </span>
                  {manage ? (
                    <span className="flex items-start gap-1.5">
                      <TeamBoardForm
                        workspaceId={workspace.id}
                        teamId={team.id}
                        boardId={board.id}
                        role={role}
                        label={fmt(t.roleOn, { board: board.title })}
                      />
                      <form action={removeTeamBoardAction}>
                        <input type="hidden" name="workspaceId" value={workspace.id} />
                        <input type="hidden" name="teamId" value={team.id} />
                        <input type="hidden" name="boardId" value={board.id} />
                        <Button
                          type="submit"
                          variant="dangerOutline"
                          className="h-9 px-3"
                          aria-label={fmt(t.removeBoard, { board: board.title })}
                        >
                          {t.remove}
                        </Button>
                      </form>
                    </span>
                  ) : (
                    <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold">{t.boardRoles[role]}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {manage && offerBoards.length > 0 && (
            <div className="mt-4 border-t border-border pt-4">
              <TeamBoardForm
                workspaceId={workspace.id}
                teamId={team.id}
                boards={offerBoards}
                label={t.addBoard}
              />
            </div>
          )}
        </SettingsCard>
      </div>

      {manage && (
        <>
          <SettingsCard title={t.identity}>
            <TeamForm workspaceId={workspace.id} team={team} />
          </SettingsCard>
          <SettingsCard tone="danger" title={t.delete} description={t.deleteText}>
            <form action={deleteTeamAction}>
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <input type="hidden" name="teamId" value={team.id} />
              <Button type="submit" variant="dangerSolid">
                {t.delete}
              </Button>
            </form>
          </SettingsCard>
        </>
      )}
      <p className="px-1 text-sm text-ink-muted">{t.rule}</p>
    </SettingsPage>
  );
}
