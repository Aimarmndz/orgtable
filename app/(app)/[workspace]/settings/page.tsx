import type { Metadata } from "next";
import Link from "next/link";
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
  canOwnWorkspace,
  grantableWorkspaceRoles,
} from "@/app/lib/roles";
import {
  CreateEmployeeForm,
  DeleteOrganizationForm,
  OrganizationSettingsForm,
  ResetEmployeePasswordForm,
} from "@/app/components/workspace/forms";
import { Button } from "@/app/components/ui/button";
import { getI18n } from "@/app/i18n/server";
import { fmt, plural } from "@/app/i18n/format";

// Members and settings of an organization: /<slug>/settings. Every member sees the list;
// owners and admins get the controls their role allows (roles.ts), owners the name, the
// address and deletion. The forms only offer what is allowed; the server checks it all
// again (app/lib/services/workspaces.ts). See docs/workspaces.md.

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

export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Params;
}) {
  const { workspace: slug } = await params;
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(slug, user.id);
  // Members of organizations only: a personal workspace has no members to manage.
  if (!workspace || !workspace.role || workspace.kind !== "ORGANIZATION")
    notFound();
  const role = workspace.role;
  const [members, { m, intl }] = await Promise.all([
    getWorkspaceMembers(workspace.id),
    getI18n(),
  ]);
  const t = m.workspaces;
  const grantable = grantableWorkspaceRoles(role);

  return (
    <div className="relative z-10 mx-auto w-full max-w-4xl overflow-y-auto p-6 sm:p-8">
      <Link
        href={`/${workspace.slug}`}
        className="font-mono text-xs text-ink-muted underline-offset-2 hover:text-ink hover:underline"
      >
        /{workspace.slug}
      </Link>
      <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">
        {workspace.name}
      </h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        {fmt(t.page.yourRole, { role: t.roles[role] })} · {t.roleHelp[role]}
      </p>

      <section aria-labelledby="members-title" className="mt-8">
        <h2
          id="members-title"
          className="font-display text-xl font-bold tracking-tight"
        >
          {t.members.title}{" "}
          <span className="text-sm font-normal text-ink-muted">
            ({plural(intl, t.members.count, members.length)})
          </span>
        </h2>
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
          {members.map((member) => {
            const self = member.id === user.id;
            const canAct = !self && canActOnWorkspaceMember(role, member.role);
            return (
              <li
                key={member.id}
                className="flex flex-wrap items-start gap-3 p-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {member.name}
                    {self && (
                      <span className="text-ink-muted"> ({t.members.you})</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {member.email}
                    {member.managedHere && ` · ${t.members.managed}`}
                  </p>
                  {canAct && member.managedHere && (
                    <ResetEmployeePasswordForm
                      workspaceId={workspace.id}
                      userId={member.id}
                      name={member.name}
                    />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
                        className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-ink outline-none focus-visible:border-accent"
                      >
                        {grantable.map((r) => (
                          <option key={r} value={r}>
                            {t.roles[r]}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="submit"
                        variant="subtle"
                        className="h-8 px-2.5 text-xs"
                      >
                        {t.members.save}
                      </Button>
                    </form>
                  ) : (
                    <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-muted">
                      {t.roles[member.role]}
                    </span>
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
                        variant="danger"
                        className="h-8 px-2.5 text-xs"
                        aria-label={fmt(t.members.removeLabel, {
                          name: member.name,
                        })}
                      >
                        {t.members.remove}
                      </Button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {canManageWorkspace(role) && (
        <div className="mt-6">
          <CreateEmployeeForm workspaceId={workspace.id} roles={grantable} />
        </div>
      )}

      {canOwnWorkspace(role) ? (
        <div className="mt-6 grid gap-6">
          <OrganizationSettingsForm
            workspaceId={workspace.id}
            name={workspace.name}
            slug={workspace.slug}
          />
          <DeleteOrganizationForm
            workspaceId={workspace.id}
            slug={workspace.slug}
          />
        </div>
      ) : (
        <p className="mt-6 text-sm text-ink-muted">{t.settings.ownerOnly}</p>
      )}

      <form
        action={removeMemberAction}
        className="mt-8 border-t border-border pt-6"
      >
        <input type="hidden" name="workspaceId" value={workspace.id} />
        <input type="hidden" name="userId" value={user.id} />
        <Button type="submit" variant="ghost">
          {t.members.leave}
        </Button>
        <p className="mt-1 text-xs text-ink-muted">{t.members.leaveHint}</p>
      </form>
    </div>
  );
}
