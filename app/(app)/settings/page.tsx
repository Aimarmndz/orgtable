import type { Metadata } from "next";
import Link from "next/link";
import { requireUser, verifySession } from "@/app/lib/dal";
import { prisma } from "@/app/lib/prisma";
import { getApiTokensForUser } from "@/app/lib/queries";
import { revokeApiToken } from "@/app/lib/actions/tokens";
import { revokeOtherSessions, revokeSession } from "@/app/lib/actions/account";
import { listActiveSessions } from "@/app/lib/services/account";
import { getI18n } from "@/app/i18n/server";
import { fmt, plural } from "@/app/i18n/format";
import { rich } from "@/app/i18n/rich";
import { LanguagePicker } from "@/app/components/language-picker";
import { formatDate } from "@/app/lib/format-date";
import { describeUserAgent } from "@/app/lib/user-agent";
import {
  APP_VERSION,
  AUTHOR_NAME,
  AUTHOR_URL,
  LICENSE_NAME,
  LICENSE_URL,
  sourceCodeUrl,
} from "@/app/lib/site";
import { CreateTokenForm } from "./create-token-form";
import { DeleteAccountForm, PasswordForm, ProfileForm } from "./account-forms";
import { ThemePicker } from "./theme-picker";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.settings.meta.title, description: m.settings.meta.description };
}

// Outside the component: reading the clock during render would break the purity rule.
function isExpired(d: Date | null): boolean {
  return d !== null && d.getTime() < Date.now();
}
function now(): Date {
  return new Date();
}

// The ids are URL fragments that other pages link to (/settings#data from the privacy
// policy, redirects in actions/account.ts), so they stay as they are in every language.
const SECTIONS = [
  { id: "profile", key: "profile", group: "account", icon: "user" },
  { id: "security", key: "security", group: "account", icon: "lock" },
  { id: "api", key: "api", group: "account", icon: "code" },
  { id: "appearance", key: "appearance", group: "account", icon: "moon" },
  { id: "data", key: "data", group: "data", icon: "download" },
  { id: "about", key: "about", group: "data", icon: "info" },
] as const;

const LINK = "text-accent underline-offset-2 hover:underline";
const SUBHEADING =
  "mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted";

const ICONS: Record<(typeof SECTIONS)[number]["icon"], React.ReactNode> = {
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  code: <path d="M8 9l-4 3 4 3M16 9l4 3-4 3M14 5l-4 14" />,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  download: <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </>
  ),
};

function Section({
  id,
  title,
  description,
  children,
  tone = "default",
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  tone?: "default" | "plain";
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={
        tone === "plain"
          ? "scroll-mt-20"
          : "scroll-mt-20 rounded-2xl border border-border bg-surface p-5 shadow-[0_1px_2px_oklch(0.27_0.022_52/0.04)] sm:p-7"
      }
    >
      <h2 id={`${id}-title`} className="font-display text-xl font-bold tracking-tight">
        {title}
      </h2>
      {description && (
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{description}</p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default async function SettingsPage() {
  const user = await requireUser();
  const { intl, m } = await getI18n();
  const t = m.settings;
  const session = await verifySession();
  const [tokens, sessions, ownedBoards] = await Promise.all([
    getApiTokensForUser(user.id),
    listActiveSessions(user.id, now()),
    prisma.board.count({ where: { ownerId: user.id } }),
  ]);
  const otherSessions = sessions.filter((s) => s.id !== session?.sessionId).length;
  const groups = [...new Set(SECTIONS.map((s) => s.group))];

  return (
    <div className="relative z-10 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 md:flex-row md:gap-10 md:py-10">
        <nav aria-label={t.navLabel} className="shrink-0 md:w-56">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">{t.title}</h1>
          <p className="mt-1 truncate text-sm text-ink-muted" title={user.email}>
            {user.name}
          </p>
          {/* On mobile the links scroll horizontally; from md up, a column. */}
          <div className="-mx-4 mt-5 flex gap-1 overflow-x-auto px-4 md:mx-0 md:block md:overflow-visible md:px-0">
            {groups.map((group) => (
              <div key={group} className="contents md:mt-5 md:block md:first:mt-0">
                <p className="mb-1.5 hidden px-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted md:block">
                  {t.groups[group]}
                </p>
                <ul className="flex shrink-0 gap-1 md:flex-col">
                  {SECTIONS.filter((s) => s.group === group).map((s) => (
                    <li key={s.id}>
                      <a
                        href={`#${s.id}`}
                        className="flex items-center gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        <svg
                          className="size-[18px] shrink-0"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          {ICONS[s.icon]}
                        </svg>
                        {t.sections[s.key]}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <Section
            id="profile"
            title={t.sections.profile}
            description={t.profile.description}
          >
            <ProfileForm name={user.name} email={user.email} />
          </Section>

          <Section
            id="security"
            title={t.sections.security}
            description={t.security.description}
          >
            <PasswordForm />

            <h3 className={`mt-8 ${SUBHEADING}`}>{t.security.sessionsTitle}</h3>
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
                        <button className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10">
                          {t.security.signOut}
                        </button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
            {otherSessions > 0 && (
              <form action={revokeOtherSessions} className="mt-3">
                <button className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10">
                  {plural(intl, t.security.signOutOthers, otherSessions)}
                </button>
              </form>
            )}
          </Section>

          <Section
            id="api"
            title={t.sections.api}
            description={rich(t.tokens.description, {
              strong: (chunk) => <strong>{chunk}</strong>,
              link: (chunk) => (
                <a href={`${sourceCodeUrl()}/blob/main/docs/api/public-api.md`} className={LINK}>
                  {chunk}
                </a>
              ),
            })}
          >
            <CreateTokenForm />

            {tokens.length === 0 ? (
              <p className="mt-6 text-sm text-ink-muted">{t.tokens.empty}</p>
            ) : (
              <ul className="mt-6 divide-y divide-border overflow-hidden rounded-xl border border-border">
                {tokens.map((tk) => (
                  <li key={tk.id} className="flex items-center gap-3 bg-surface px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{tk.name}</span>
                        <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                          {tk.scope === "read" ? t.tokens.scopeRead : t.tokens.scopeWrite}
                        </span>
                        {isExpired(tk.expiresAt) && (
                          <span className="shrink-0 rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">
                            {t.tokens.expired}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-ink-muted">
                        {tk.prefix}… · {fmt(t.tokens.created, { date: formatDate(tk.createdAt, intl) })} ·{" "}
                        {tk.expiresAt
                          ? fmt(t.tokens.expires, { date: formatDate(tk.expiresAt, intl) })
                          : t.tokens.neverExpires}{" "}
                        ·{" "}
                        {tk.lastUsedAt
                          ? fmt(t.tokens.used, { date: formatDate(tk.lastUsedAt, intl) })
                          : t.tokens.neverUsed}
                      </p>
                    </div>
                    <form action={revokeApiToken}>
                      <input type="hidden" name="id" value={tk.id} />
                      <button className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10">
                        {t.tokens.revoke}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            id="appearance"
            title={t.sections.appearance}
            description={t.appearance.description}
          >
            <h3 className={SUBHEADING}>{t.appearance.theme}</h3>
            <p className="-mt-1.5 mb-3 text-sm text-ink-muted">{t.appearance.themeHint}</p>
            <ThemePicker />

            <h3 className={`mt-8 ${SUBHEADING}`}>{m.common.language.label}</h3>
            <p className="-mt-1.5 mb-3 text-sm text-ink-muted">{m.common.language.description}</p>
            <LanguagePicker variant="cards" />
          </Section>

          <Section
            id="data"
            title={t.sections.data}
            description={rich(t.data.description, {
              link: (chunk) => (
                <Link href="/legal/privacy" className={LINK}>
                  {chunk}
                </Link>
              ),
            })}
          >
            <div className="flex flex-col gap-4 rounded-xl bg-surface-2 p-4 sm:flex-row sm:items-center">
              <div className="flex-1">
                <p className="text-sm font-semibold">{t.data.export.title}</p>
                <p className="mt-0.5 text-sm text-ink-muted">{t.data.export.description}</p>
              </div>
              {/* A plain link (no fetch): the browser downloads the file with its name. */}
              <a
                href="/api/account/export"
                download
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition hover:bg-bg active:translate-y-px"
              >
                {t.data.export.button}
              </a>
            </div>

            <div className="mt-4 rounded-xl border border-danger/35 p-4 sm:p-5">
              <h3 className="text-sm font-bold text-danger">{t.data.delete.title}</h3>
              <p className="mt-1 mb-4 text-sm text-ink-muted">
                {ownedBoards === 0
                  ? t.data.delete.descriptionNoBoards
                  : plural(intl, t.data.delete.descriptionWithBoards, ownedBoards)}
              </p>
              <DeleteAccountForm />
            </div>
          </Section>

          <Section id="about" title={t.sections.about} tone="plain">
            <div className="flex flex-col gap-2 text-sm text-ink-muted sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <p>
                {rich(
                  t.about.line,
                  {
                    version: (chunk) => <span className="font-mono">{chunk}</span>,
                    source: (chunk) => (
                      <a href={sourceCodeUrl()} className={LINK}>
                        {chunk}
                      </a>
                    ),
                    license: (chunk) => (
                      <a href={LICENSE_URL} className={LINK}>
                        {chunk}
                      </a>
                    ),
                  },
                  { version: APP_VERSION, license: LICENSE_NAME },
                )}
              </p>
              {/* Attribution required by LICENSE (section 7(b) terms): derivatives must keep
                  it. Same message as the public footer; the licence allows translating the
                  words "Created by". */}
              <p>
                {rich(
                  m.legal.footer.createdBy,
                  {
                    link: (chunk) => (
                      <a href={AUTHOR_URL} className="text-accent underline-offset-2 hover:underline">
                        {chunk}
                      </a>
                    ),
                  },
                  { author: AUTHOR_NAME },
                )}
              </p>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
