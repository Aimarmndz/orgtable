import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOrgSettings } from "@/app/lib/org-settings";
import { prisma } from "@/app/lib/prisma";
import { canActOnWorkspaceMember, canManageWorkspace } from "@/app/lib/roles";
import { orgSecurityOverview } from "@/app/lib/services/org-security";
import { resetManagedTwoFactorAction, revokeManagedSessionsAction } from "@/app/lib/actions/org-security";
import { BOARD_COLORS, pickBoardColor } from "@/app/lib/colors";
import { initials } from "@/app/lib/initials";
import { formatDate } from "@/app/lib/format-date";
import { describeUserAgent } from "@/app/lib/user-agent";
import { PageHeader, SettingsCard, SettingsPage } from "@/app/components/settings/page-header";
import { OrgSecurityForm } from "@/app/components/workspace/security-form";
import { Button } from "@/app/components/ui/button";
import { getI18n } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";

// /<slug>/settings/security: the organization's security policy and who meets it (owners and
// admins). Sessions are listed only for the accounts this organization created, the same
// boundary as resetting their password. See docs/workspaces.md, "Security".

type Params = Promise<{ workspace: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgSettings(slug);
  const { m } = await getI18n();
  return { title: `${m.workspaces.security.title} · ${workspace.name}` };
}

function now(): Date {
  return new Date();
}

export default async function OrgSecurityPage({ params }: { params: Params }) {
  const { workspace: slug } = await params;
  const { user, workspace, role } = await requireOrgSettings(slug);
  if (!canManageWorkspace(role)) notFound();
  const [{ intl, m }, policy, people] = await Promise.all([
    getI18n(),
    prisma.workspace.findUniqueOrThrow({
      where: { id: workspace.id },
      select: { requireTwoFactor: true, allowedEmailDomains: true },
    }),
    orgSecurityOverview(workspace.id, now()),
  ]);
  const t = m.workspaces.security;
  const withTwoFactor = people.filter((p) => p.twoFactor).length;
  const percent = people.length ? Math.round((withTwoFactor / people.length) * 100) : 0;
  const without = people.filter((p) => !p.twoFactor);
  const managed = people.filter((p) => p.managedHere && p.id !== user.id);

  return (
    <SettingsPage wide>
      <PageHeader address={`/${workspace.slug}/settings/security`} title={t.title} description={t.subtitle} />

      <SettingsCard title={t.adoptionTitle} description={fmt(t.adoption, { count: String(withTwoFactor), total: String(people.length) })}>
        <div
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label={t.adoptionTitle}
          className="h-2.5 overflow-hidden rounded-full bg-surface-2"
        >
          <div className="h-full rounded-full bg-success" style={{ width: `${percent}%` }} />
        </div>
        {without.length > 0 && (
          <p className="mt-3 text-sm text-ink-muted">
            {fmt(t.without, { names: without.map((p) => p.name).join(", ") })}
          </p>
        )}
        {policy.requireTwoFactor && without.length > 0 && (
          <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{t.blockedNow}</p>
        )}
      </SettingsCard>

      <SettingsCard title={t.policyTitle}>
        <OrgSecurityForm
          workspaceId={workspace.id}
          requireTwoFactor={policy.requireTwoFactor}
          domains={policy.allowedEmailDomains}
          readOnly={false}
        />
      </SettingsCard>

      <SettingsCard title={t.sessionsTitle} description={t.sessionsHint}>
        {managed.length === 0 ? (
          <p className="text-sm text-ink-muted">{t.noManaged}</p>
        ) : (
          <ul className="divide-y divide-border">
            {managed.map((p) => {
              const canAct = canActOnWorkspaceMember(role, p.role);
              return (
                <li key={p.id} data-menu-scope="row" className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      aria-hidden
                      className="grid size-8 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
                      style={{ background: BOARD_COLORS[pickBoardColor(p.id)] }}
                    >
                      {initials(p.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{p.name}</span>
                      <span className="block truncate text-xs text-ink-muted">
                        {p.email} · {p.twoFactor ? t.has2fa : t.no2fa}
                      </span>
                    </span>
                    {canAct && p.sessions.length > 0 && (
                      <form action={revokeManagedSessionsAction}>
                        <input type="hidden" name="workspaceId" value={workspace.id} />
                        <input type="hidden" name="userId" value={p.id} />
                        <Button type="submit" variant="dangerOutline" className="h-8 px-3">
                          {t.closeAll}
                        </Button>
                      </form>
                    )}
                    {canAct && p.twoFactor && (
                      <form action={resetManagedTwoFactorAction}>
                        <input type="hidden" name="workspaceId" value={workspace.id} />
                        <input type="hidden" name="userId" value={p.id} />
                        <Button type="submit" variant="outline" className="h-8 px-3">
                          {t.reset2fa}
                        </Button>
                      </form>
                    )}
                  </div>
                  {p.sessions.length > 0 && (
                    <ul className="ml-11 flex flex-col gap-1">
                      {p.sessions.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-medium">{describeUserAgent(s.userAgent, m.settings.security)}</span>
                          <span className="font-mono text-ink-muted">
                            {fmt(m.settings.security.sessionDates, {
                              started: formatDate(s.createdAt, intl),
                              expires: formatDate(s.expiresAt, intl),
                            })}
                          </span>
                          {canAct && (
                            <form action={revokeManagedSessionsAction}>
                              <input type="hidden" name="workspaceId" value={workspace.id} />
                              <input type="hidden" name="userId" value={p.id} />
                              <input type="hidden" name="sessionId" value={s.id} />
                              <button type="submit" className="font-semibold text-danger hover:underline">
                                {m.settings.security.signOut}
                              </button>
                            </form>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SettingsCard>
    </SettingsPage>
  );
}
