import type { Metadata } from "next";
import { requireUser, verifySession } from "@/app/lib/dal";
import { revokeOtherSessions, revokeSession } from "@/app/lib/actions/account";
import { listActiveSessions } from "@/app/lib/services/account";
import { formatDate } from "@/app/lib/format-date";
import { describeUserAgent } from "@/app/lib/user-agent";
import { PageHeader, SettingsCard, SettingsPage } from "@/app/components/settings/page-header";
import { Button } from "@/app/components/ui/button";
import { getI18n } from "@/app/i18n/server";
import { fmt, plural } from "@/app/i18n/format";
import { PasswordForm } from "../account-forms";

// /settings/security: password and the open sessions.

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.settings.nav.security };
}

// Outside the component: reading the clock during render would break the purity rule.
function now(): Date {
  return new Date();
}

export default async function SecuritySettingsPage() {
  const user = await requireUser();
  const [{ intl, m }, session, sessions] = await Promise.all([
    getI18n(),
    verifySession(),
    listActiveSessions(user.id, now()),
  ]);
  const t = m.settings;
  const otherSessions = sessions.filter((s) => s.id !== session?.sessionId).length;
  return (
    <SettingsPage>
      <PageHeader address="/settings/security" title={t.nav.security} description={t.security.description} />
      <SettingsCard title={t.security.passwordTitle}>
        <PasswordForm />
      </SettingsCard>
      <SettingsCard
        title={t.security.sessionsTitle}
        description={t.security.sessionsHint}
        aside={
          otherSessions > 0 ? (
            <form action={revokeOtherSessions}>
              <Button type="submit" variant="dangerOutline" className="h-9 px-3">
                {plural(intl, t.security.signOutOthers, otherSessions)}
              </Button>
            </form>
          ) : undefined
        }
      >
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {sessions.map((s) => {
            const current = s.id === session?.sessionId;
            return (
              <li key={s.id} className="flex items-center gap-3 bg-surface px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {describeUserAgent(s.userAgent, t.security)}
                    {current && (
                      <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                        {t.security.thisSession}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-ink-muted">
                    {fmt(t.security.sessionDates, {
                      started: formatDate(s.createdAt, intl),
                      expires: formatDate(s.expiresAt, intl),
                    })}
                  </p>
                </div>
                {!current && (
                  <form action={revokeSession}>
                    <input type="hidden" name="sessionId" value={s.id} />
                    <Button type="submit" variant="dangerOutline" className="h-8 px-3">
                      {t.security.signOut}
                    </Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </SettingsCard>
    </SettingsPage>
  );
}
