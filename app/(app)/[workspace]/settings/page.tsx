import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/app/lib/dal";
import { getWorkspaceForUser, getWorkspaceMembers } from "@/app/lib/queries";
import {
  changeMemberRoleAction,
  removeMemberAction,
} from "@/app/lib/actions/workspaces";
import {
  canActOnWorkspaceMember,
  canManageWorkspace,
  grantableWorkspaceRoles,
  type WorkspaceRole,
} from "@/app/lib/roles";
import { BOARD_COLORS, pickBoardColor } from "@/app/lib/colors";
import { initials } from "@/app/lib/initials";
import { isMailEnabled } from "@/app/lib/mail/config";
import {
  CreateEmployeeForm,
  ResetEmployeePasswordForm,
} from "@/app/components/workspace/forms";
import { Button } from "@/app/components/ui/button";
import { getI18n } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";

// Members of an organization: /<slug>/settings (DESIGN.md, "Settings and administration").
// Every member sees the list; owners and admins get the controls their role allows
// (roles.ts). The forms only offer what is allowed; the server checks it all again
// (app/lib/services/workspaces.ts). The layout already checked membership.

type Params = Promise<{ workspace: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { workspace: slug } = await params;
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(slug, user.id);
  const { m } = await getI18n();
  return {
    title: fmt(m.workspaces.settings.metaTitle, {
      name: workspace?.name ?? slug,
    }),
  };
}

const ROLES: WorkspaceRole[] = ["OWNER", "ADMIN", "MEMBER"];

export default async function WorkspaceMembersPage({
  params,
}: {
  params: Params;
}) {
  const { workspace: slug } = await params;
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(slug, user.id);
  if (!workspace || !workspace.role || workspace.kind !== "ORGANIZATION")
    notFound();
  const role = workspace.role;
  const [members, { m }] = await Promise.all([
    getWorkspaceMembers(workspace.id),
    getI18n(),
  ]);
  const t = m.workspaces;
  const grantable = grantableWorkspaceRoles(role);
  const manager = canManageWorkspace(role);

  return (
    <div className="mx-auto w-full max-w-5xl p-6 sm:p-8 lg:p-10">
      <p className="font-mono text-xs text-ink-muted">/{workspace.slug}</p>
      <div className="mt-1.5 flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">
            {t.nav.members}
          </h1>
          <p className="mt-1.5 text-[15px] text-ink-muted">
            {fmt(t.members.subtitle, { name: workspace.name })}{" "}
            {fmt(t.page.yourRole, { role: t.roles[role] })}.
          </p>
        </div>
        {manager && (
          <a
            href="#create-employee"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink shadow-sm transition hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              className="size-4"
              aria-hidden
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t.members.createButton}
          </a>
        )}
      </div>

      {/* What each role can do, with how many people hold it. */}
      <dl className="mt-7 grid gap-3 sm:grid-cols-3">
        {ROLES.map((r) => (
          <div
            key={r}
            className="rounded-2xl border border-border bg-surface p-4"
          >
            <dt className="text-xs font-bold uppercase tracking-wide text-ink-muted">
              {t.members.summary[r]}
            </dt>
            <dd className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
              {members.filter((x) => x.role === r).length}
            </dd>
            <dd className="mt-0.5 text-sm text-ink-muted">{t.roleHelp[r]}</dd>
          </div>
        ))}
      </dl>

      <section
        aria-labelledby="members-title"
        className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface"
      >
        <h2 id="members-title" className="sr-only">
          {t.members.title}
        </h2>
        <div className="hidden grid-cols-[minmax(0,2fr)_minmax(13rem,1.2fr)_minmax(0,1.6fr)] gap-3 bg-surface-2 px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-ink-muted md:grid">
          <span>{t.members.columns.person}</span>
          <span>{t.members.columns.role}</span>
          <span className="text-right">{t.members.columns.actions}</span>
        </div>
        <ul className="divide-y divide-border">
          {members.map((member) => {
            const self = member.id === user.id;
            const canAct = !self && canActOnWorkspaceMember(role, member.role);
            return (
              <li
                key={member.id}
                className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,2fr)_minmax(13rem,1.2fr)_minmax(0,1.6fr)] md:items-center"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden
                    className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
                    style={{
                      background: BOARD_COLORS[pickBoardColor(member.id)],
                    }}
                  >
                    {initials(member.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {member.name}
                      {self && (
                        <span className="font-medium text-ink-muted">
                          {" "}
                          ({t.members.you})
                        </span>
                      )}
                    </p>
                    <p className="truncate text-sm text-ink-muted">
                      {member.email} ·{" "}
                      {member.managedHere ? (
                        <span className="font-semibold text-success">
                          {t.members.createdHere}
                        </span>
                      ) : (
                        t.members.joined
                      )}
                    </p>
                  </div>
                </div>

                <div>
                  {canAct && grantable.length > 1 ? (
                    <form
                      action={changeMemberRoleAction}
                      className="flex items-center gap-1.5"
                    >
                      <input
                        type="hidden"
                        name="workspaceId"
                        value={workspace.id}
                      />
                      <input type="hidden" name="userId" value={member.id} />
                      <select
                        name="role"
                        defaultValue={member.role}
                        aria-label={fmt(t.members.changeRole, {
                          name: member.name,
                        })}
                        className="h-9 w-36 shrink-0 rounded-lg border border-ink/20 bg-surface px-2.5 text-sm font-semibold text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
                      >
                        {grantable.map((r) => (
                          <option key={r} value={r}>
                            {t.roles[r]}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="submit"
                        variant="outline"
                        className="h-9 px-3"
                      >
                        {t.members.save}
                      </Button>
                    </form>
                  ) : (
                    <span
                      className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold ${
                        member.role === "OWNER"
                          ? "bg-ink text-bg"
                          : "bg-surface-2 text-ink"
                      }`}
                    >
                      {t.roles[member.role]}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-start gap-2 md:justify-end">
                  {canAct && member.managedHere && (
                    <details className="group/pw relative">
                      <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg border border-ink/20 bg-surface px-3 text-sm font-semibold text-ink shadow-sm transition hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className="size-4"
                          aria-hidden
                        >
                          <rect x="4" y="10" width="16" height="10" rx="2" />
                          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                        </svg>
                        {t.members.newPassword}
                      </summary>
                      <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-border bg-surface p-4 shadow-[0_16px_40px_-16px_oklch(0.27_0.022_52/0.45)]">
                        <ResetEmployeePasswordForm
                          workspaceId={workspace.id}
                          userId={member.id}
                          name={member.name}
                        />
                      </div>
                    </details>
                  )}
                  {canAct && (
                    <form action={removeMemberAction}>
                      <input
                        type="hidden"
                        name="workspaceId"
                        value={workspace.id}
                      />
                      <input type="hidden" name="userId" value={member.id} />
                      <Button
                        type="submit"
                        variant="dangerOutline"
                        className="h-9 px-3"
                        aria-label={fmt(t.members.removeLabel, {
                          name: member.name,
                        })}
                      >
                        {t.members.remove}
                      </Button>
                    </form>
                  )}
                  {!canAct && (
                    <span className="text-sm text-ink-muted md:pr-1">—</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {manager && (
        <div id="create-employee" className="mt-6 scroll-mt-6">
          <CreateEmployeeForm
            workspaceId={workspace.id}
            roles={grantable}
            invite={isMailEnabled()}
          />
        </div>
      )}
    </div>
  );
}
