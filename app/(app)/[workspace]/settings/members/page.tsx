import type { Metadata } from "next";
import Link from "next/link";
import { requireOrgSettings } from "@/app/lib/org-settings";
import { getWorkspaceMembers } from "@/app/lib/queries";
import { listCustomRoles } from "@/app/lib/services/roles";
import { changeMemberRoleAction, removeMemberAction } from "@/app/lib/actions/workspaces";
import {
  canActOnWorkspaceMember,
  canManageWorkspace,
  grantableWorkspaceRoles,
  type WorkspaceRole,
} from "@/app/lib/roles";
import { BOARD_COLORS, pickBoardColor, type BoardColor } from "@/app/lib/colors";
import { initials } from "@/app/lib/initials";
import { UserPhoto } from "@/app/components/user-photo";
import { ResetEmployeePasswordForm } from "@/app/components/workspace/forms";
import { roleOptions } from "@/app/components/workspace/role-options";
import { PageHeader, SettingsPage } from "@/app/components/settings/page-header";
import { Button } from "@/app/components/ui/button";
import { getI18n } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";

// Members of an organization: /<slug>/settings/members (DESIGN.md, "Settings and
// administration"). Every member sees the list; the controls follow the person's role and
// permissions (roles.ts, permissions.ts): owners and admins change roles (custom ones too)
// and act on whom roles.ts allows; a custom role with "people.remove" removes plain
// members; "people.invite" opens the new-employee page. The server checks it all again
// (app/lib/services/workspaces.ts).

type Params = Promise<{ workspace: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgSettings(slug);
  const { m } = await getI18n();
  return { title: `${m.workspaces.nav.members} · ${workspace.name}` };
}

const ROLES: WorkspaceRole[] = ["OWNER", "ADMIN", "MEMBER"];

function colorOf(key: string): string {
  return BOARD_COLORS[(key in BOARD_COLORS ? key : "blue") as BoardColor];
}

export default async function WorkspaceMembersPage({ params }: { params: Params }) {
  const { workspace: slug } = await params;
  const { user, workspace, role, customRole, permissions } = await requireOrgSettings(slug);
  const [members, customRoles, { m }] = await Promise.all([
    getWorkspaceMembers(workspace.id),
    listCustomRoles(workspace.id),
    getI18n(),
  ]);
  const t = m.workspaces;
  const manager = canManageWorkspace(role);
  const options = manager ? roleOptions(m, grantableWorkspaceRoles(role), customRoles) : [];
  const mayRemove = (target: WorkspaceRole) =>
    manager ? canActOnWorkspaceMember(role, target) : permissions.has("people.remove") && target === "MEMBER";

  return (
    <SettingsPage wide>
      <PageHeader
        address={`/${workspace.slug}/settings/members`}
        title={t.nav.members}
        description={`${fmt(t.members.subtitle, { name: workspace.name })} ${fmt(t.page.yourRole, {
          role: customRole ? fmt(t.members.memberAs, { role: customRole.name }) : t.roles[role],
        })}.`}
        action={
          permissions.has("people.invite") ? (
            <Link
              href={`/${workspace.slug}/settings/members/new`}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink shadow-sm transition hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="size-4" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
              {t.members.createButton}
            </Link>
          ) : undefined
        }
      />

      {/* What each role can do, with how many people hold it. */}
      <dl className="grid gap-3 sm:grid-cols-3">
        {ROLES.map((r) => (
          <div key={r} className="rounded-2xl border border-border bg-surface p-4">
            <dt className="text-xs font-bold uppercase tracking-wide text-ink-muted">{t.members.summary[r]}</dt>
            <dd className="mt-1.5 font-mono text-2xl font-semibold tabular-nums">
              {members.filter((x) => x.role === r).length}
            </dd>
            <dd className="mt-0.5 text-sm text-ink-muted">{t.roleHelp[r]}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="members-title" className="overflow-hidden rounded-2xl border border-border bg-surface">
        <h2 id="members-title" className="sr-only">
          {t.members.title}
        </h2>
        <div className="hidden grid-cols-[minmax(0,2fr)_minmax(15rem,1.3fr)_minmax(0,1.5fr)] gap-3 bg-surface-2 px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-ink-muted md:grid">
          <span>{t.members.columns.person}</span>
          <span>{t.members.columns.role}</span>
          <span className="text-right">{t.members.columns.actions}</span>
        </div>
        <ul className="divide-y divide-border">
          {members.map((member) => {
            const self = member.id === user.id;
            const canChange = manager && !self && canActOnWorkspaceMember(role, member.role) && options.length > 1;
            const canRemove = !self && mayRemove(member.role);
            const canReset = manager && !self && canActOnWorkspaceMember(role, member.role) && member.managedHere;
            const current = member.customRole ? `custom:${member.customRole.id}` : member.role;
            return (
              <li
                key={member.id}
                data-menu-scope="row"
                data-menu-title={member.name}
                className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,2fr)_minmax(15rem,1.3fr)_minmax(0,1.5fr)] md:items-center"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <UserPhoto user={member} size={36}>
                    <span
                      aria-hidden
                      className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
                      style={{ background: BOARD_COLORS[pickBoardColor(member.id)] }}
                    >
                      {initials(member.name)}
                    </span>
                  </UserPhoto>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {member.name}
                      {self && <span className="font-medium text-ink-muted"> ({t.members.you})</span>}
                    </p>
                    <p className="truncate text-sm text-ink-muted">
                      {member.email} ·{" "}
                      {member.managedHere ? (
                        <span className="font-semibold text-success">{t.members.createdHere}</span>
                      ) : (
                        t.members.joined
                      )}
                    </p>
                  </div>
                </div>

                <div>
                  {canChange ? (
                    <form action={changeMemberRoleAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="workspaceId" value={workspace.id} />
                      <input type="hidden" name="userId" value={member.id} />
                      <select
                        name="role"
                        defaultValue={current}
                        aria-label={fmt(t.members.changeRole, { name: member.name })}
                        className="h-9 min-w-0 flex-1 rounded-lg border border-ink/20 bg-surface px-2.5 text-sm font-semibold text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
                      >
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <Button type="submit" variant="outline" className="h-9 px-3">
                        {t.members.save}
                      </Button>
                    </form>
                  ) : member.customRole ? (
                    <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 text-xs font-semibold text-ink">
                      <span aria-hidden className="size-2 rounded-full" style={{ background: colorOf(member.customRole.color) }} />
                      {member.customRole.name}
                    </span>
                  ) : (
                    <span
                      className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold ${
                        member.role === "OWNER" ? "bg-ink text-bg" : "bg-surface-2 text-ink"
                      }`}
                    >
                      {t.roles[member.role]}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-start gap-2 md:justify-end">
                  {canReset && (
                    <details className="group/pw relative">
                      <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg border border-ink/20 bg-surface px-3 text-sm font-semibold text-ink shadow-sm transition hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4" aria-hidden>
                          <rect x="4" y="10" width="16" height="10" rx="2" />
                          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                        </svg>
                        {t.members.newPassword}
                      </summary>
                      <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-border bg-surface p-4 shadow-[0_16px_40px_-16px_oklch(0.27_0.022_52/0.45)]">
                        <ResetEmployeePasswordForm workspaceId={workspace.id} userId={member.id} name={member.name} />
                      </div>
                    </details>
                  )}
                  {canRemove && (
                    <form action={removeMemberAction}>
                      <input type="hidden" name="workspaceId" value={workspace.id} />
                      <input type="hidden" name="userId" value={member.id} />
                      <Button
                        type="submit"
                        variant="dangerOutline"
                        className="h-9 px-3"
                        aria-label={fmt(t.members.removeLabel, { name: member.name })}
                      >
                        {t.members.remove}
                      </Button>
                    </form>
                  )}
                  {!canReset && !canRemove && <span className="text-sm text-ink-muted md:pr-1">—</span>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </SettingsPage>
  );
}
