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
import Link from "next/link";
import { twoFactorStatus } from "@/app/lib/services/two-factor";
import { isSecretKeyConfigured } from "@/app/lib/crypto/secrets";
import { DisableTwoFactorForm, RegenerateCodesForm } from "@/app/components/settings/two-factor-forms";

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
  const [{ intl, m }, session, sessions, twoFactor] = await Promise.all([
    getI18n(),
    verifySession(),
    listActiveSessions(user.id, now()),
    twoFactorStatus(user.id),
  ]);
  const tf = m.settings.twoFactor;
  const t = m.settings;
  const otherSessions = sessions.filter((s) => s.id !== session?.sessionId).length;
  return (
    <SettingsPage>
      <PageHeader address="/settings/security" title={t.nav.security} description={t.security.description} />
      <SettingsCard title={t.security.passwordTitle}>
        <PasswordForm />
      </SettingsCard>
      <SettingsCard
        title={tf.title}
        description={
          twoFactor.enabledAt
            ? fmt(tf.on, { date: formatDate(twoFactor.enabledAt, intl), count: String(twoFactor.recoveryLeft) })
            : tf.off
        }
        aside={
          twoFactor.enabledAt ? (
            <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success">{tf.onBadge}</span>
          ) : isSecretKeyConfigured() ? (
            <Link
              href="/settings/security/two-factor"
              className="inline-flex min-h-10 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink shadow-sm hover:bg-accent-hover"
            >
              {tf.enable}
            </Link>
          ) : undefined
        }
      >
        {twoFactor.enabledAt ? (
          <div className="grid gap-4 md:grid-cols-2">
            <details className="rounded-xl border border-border p-4">
              <summary className="cursor-pointer text-sm font-semibold">{tf.regenerate}</summary>
              <div className="mt-3">
                <RegenerateCodesForm />
              </div>
            </details>
            <details className="rounded-xl border border-danger/30 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-danger">{tf.disable}</summary>
              <div className="mt-3">
                <DisableTwoFactorForm />
              </div>
            </details>
          </div>
        ) : !isSecretKeyConfigured() ? (
          <p className="text-sm text-ink-muted">{tf.noKey}</p>
        ) : undefined}
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
