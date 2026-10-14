import Link from "next/link";
import type { ReactNode } from "react";
import { getI18n } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";
import { rich } from "@/app/i18n/rich";
import { PublicFooter } from "@/app/components/public-footer";
import { APP_VERSION } from "@/app/lib/site";
import { BOARD_COLORS, LABEL_COLORS } from "@/app/lib/colors";
import { docUrl, installCommand } from "@/app/lib/landing";
import { CopyCommand } from "./copy-command";
import { silkscreen, vt323 } from "./fonts";

// Public landing page at `/` for visitors without a session (app/page.tsx decides when).
// Retro look over the app's warm palette: see DESIGN.md, "Landing". Every text is in
// locales/<code>/landing.json; the links and the install command come from the instance's
// configuration (app/lib/landing.ts, app/lib/site.ts).

type Props = {
  registrationOpen: boolean;
  // The address visitors typed (Host header), to show what a company's board URL looks like.
  host: string;
  installScriptUrl: string;
  sourceUrl: string;
};

const linkClass =
  "rounded-sm underline-offset-4 hover:text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export async function LandingPage({
  registrationOpen,
  host,
  installScriptUrl,
  sourceUrl,
}: Props) {
  const { m } = await getI18n();
  const t = m.landing;
  const command = installCommand(installScriptUrl);
  const signUp = registrationOpen ? "/register" : "/login";

  return (
    <div
      className={`${silkscreen.variable} ${vt323.variable} landing-dots relative z-10 flex min-h-[100dvh] flex-1 flex-col`}
    >
      <a
        href="#main"
        className="sr-only z-30 rounded bg-accent px-4 py-2 font-semibold text-accent-ink focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        {t.skipToContent}
      </a>

      <header className="sticky top-0 z-20 border-b-2 border-retro-edge bg-surface">
        <div className="mx-auto flex min-h-17 max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent"
          >
            <LogoMark />
            <span className="font-display text-2xl font-extrabold">
              orgtable
            </span>
          </Link>
          <nav
            aria-label={t.nav.label}
            className="order-last flex w-full flex-wrap gap-x-5 gap-y-1 text-[15px] font-semibold md:order-none md:mr-auto md:w-auto"
          >
            <a href="#features" className={linkClass}>
              {t.nav.features}
            </a>
            <a href="#teams" className={linkClass}>
              {t.nav.teams}
            </a>
            <a href="#paths" className={linkClass}>
              {t.nav.paths}
            </a>
            <a href="#install" className={linkClass}>
              {t.nav.install}
            </a>
            <a href={sourceUrl} className={linkClass}>
              {t.nav.source}
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-4 md:ml-0">
            <Link
              href="/login"
              className={`text-[15px] font-semibold ${linkClass}`}
            >
              {t.nav.signIn}
            </Link>
            {registrationOpen && (
              <Link
                href="/register"
                className="retro-btn min-h-11 bg-accent px-4 text-[15px] text-accent-ink"
              >
                {t.nav.useFree}
              </Link>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        {/* Hero */}
        <section className="mx-auto flex max-w-6xl flex-wrap items-center gap-14 px-4 pb-22 pt-16 sm:px-6 lg:pt-20">
          <div className="min-w-0 flex-[1.4_1_30rem]">
            <p className="mb-6 inline-block rounded-[3px] bg-terminal px-3 py-1.5 font-pixel text-[13px] text-phosphor">
              {fmt(t.hero.badge, { version: APP_VERSION })}
            </p>
            <h1 className="font-display text-5xl leading-[0.98] font-extrabold text-balance sm:text-6xl lg:text-7xl">
              {t.hero.titleLine1}
              <br />
              <span className="text-accent">{t.hero.titleLine2}</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-muted sm:text-xl">
              {t.hero.intro}
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href={signUp}
                className="retro-btn bg-accent text-[17px] text-accent-ink"
              >
                {registrationOpen ? t.hero.ctaFree : t.hero.ctaSignIn}
                <ArrowIcon />
              </Link>
              {registrationOpen && (
                <Link
                  href="/register?type=organization"
                  className="retro-btn bg-surface text-[17px] text-ink"
                >
                  {t.hero.ctaCompany}
                </Link>
              )}
              <a
                href="#install"
                className="retro-btn bg-surface text-[17px] text-ink"
              >
                <span aria-hidden className="font-pixel text-sm">
                  $_
                </span>
                {t.hero.ctaInstall}
              </a>
            </div>
            <p className="mt-5 text-sm text-ink-muted">
              {registrationOpen ? t.hero.note : t.hero.closedNote}
            </p>
          </div>

          <div className="relative min-w-0 flex-[1_1_24rem]">
            <BoardWindow t={t.board} />
          </div>
        </section>

        {/* Ticker */}
        <div className="overflow-hidden border-y-2 border-retro-edge bg-accent py-3.5 text-accent-ink">
          <div
            aria-hidden
            className="retro-ticker font-pixel text-[15px] whitespace-nowrap"
          >
            <span className="px-4">★ {t.ticker} ★</span>
            <span className="px-4">★ {t.ticker} ★</span>
          </div>
          <p className="sr-only">{t.ticker}</p>
        </div>

        {/* Features */}
        <section
          id="features"
          aria-labelledby="features-title"
          className="mx-auto max-w-6xl scroll-mt-24 px-4 py-24 sm:px-6"
        >
          <Kicker>{t.features.kicker}</Kicker>
          <h2
            id="features-title"
            className="mt-2.5 max-w-3xl font-display text-4xl leading-[1.05] font-extrabold text-balance sm:text-5xl"
          >
            {t.features.title}
          </h2>
          <p className="mt-4 max-w-2xl text-lg text-ink-muted">
            {t.features.intro}
          </p>
          <ul className="mt-12 grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ key, icon }) => {
              const f = t.features[key];
              return (
                <li key={key} className="retro-window">
                  <div className="retro-titlebar" aria-hidden>
                    <span className="retro-close" />
                    <span className="retro-title">{f.file}</span>
                  </div>
                  <div className="p-6">
                    {icon}
                    <h3 className="mt-3.5 font-display text-[22px] font-bold">
                      {f.title}
                    </h3>
                    <p className="mt-2 leading-relaxed text-ink-muted">
                      {f.text}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Organizations: their own address, employees and roles */}
        <section
          id="teams"
          aria-labelledby="teams-title"
          className="mx-auto flex max-w-6xl scroll-mt-24 flex-wrap items-center gap-14 px-4 pb-24 sm:px-6"
        >
          <div className="min-w-0 flex-[1_1_26rem]">
            <Kicker>{t.teams.kicker}</Kicker>
            <h2
              id="teams-title"
              className="mt-2.5 font-display text-4xl leading-[1.05] font-extrabold text-balance sm:text-5xl"
            >
              {t.teams.title}
            </h2>
            <p className="mt-4 text-lg text-ink-muted">{t.teams.intro}</p>
            {registrationOpen && (
              <Link
                href="/register?type=organization"
                className="retro-btn mt-8 bg-accent text-accent-ink"
              >
                {t.teams.cta}
                <ArrowIcon />
              </Link>
            )}
          </div>
          <div className="min-w-0 flex-[1_1_28rem]">
            <div className="retro-window">
              <div className="retro-titlebar" aria-hidden>
                <span className="retro-close" />
                <span className="retro-title">NETSCAPE.EXE</span>
              </div>
              <div className="p-5">
                {/* An address bar: the shape of every board URL. */}
                <p
                  aria-label={t.teams.urlLabel}
                  className="flex min-w-0 items-center overflow-hidden rounded-[3px] border-2 border-retro-edge bg-bg px-3 py-2.5 font-terminal text-xl sm:text-2xl"
                >
                  <span className="shrink truncate text-ink-muted">{host}/</span>
                  <span className="shrink-0 text-accent">{t.teams.urlCompany}</span>
                  <span className="shrink-0 text-ink-muted">/</span>
                  <span className="shrink-0 text-ink">{t.teams.urlBoard}</span>
                  <span aria-hidden className="crt-caret" />
                </p>
                <h3 className="mt-6 font-pixel text-[13px] text-accent">{t.teams.rolesTitle}</h3>
                <ul className="mt-3 flex flex-col gap-2.5">
                  {[t.teams.owner, t.teams.admin, t.teams.member].map((line) => (
                    <li key={line} className="flex items-start gap-2.5 leading-relaxed">
                      <span aria-hidden className="mt-2 size-2 flex-none bg-accent" />
                      <span>{rich(line, { b: (c) => <strong>{c}</strong> })}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-sm leading-relaxed text-ink-muted">{t.teams.private}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Two paths: free online or self-hosted */}
        <section
          id="paths"
          aria-labelledby="paths-title"
          className="scroll-mt-24 border-y-2 border-retro-edge bg-terminal text-phosphor"
        >
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <Kicker tone="phosphor">{t.paths.kicker}</Kicker>
            <h2
              id="paths-title"
              className="mt-2.5 max-w-3xl font-display text-4xl leading-[1.05] font-extrabold text-balance text-[oklch(0.97_0.01_80)] sm:text-5xl"
            >
              {t.paths.title}
            </h2>
            <div className="mt-12 grid gap-9 md:grid-cols-2">
              <PathCard
                tag={t.paths.online.tag}
                title={t.paths.online.title}
                text={t.paths.online.text}
                points={[
                  t.paths.online.point1,
                  t.paths.online.point2,
                  t.paths.online.point3,
                ]}
                shadow="var(--accent)"
              >
                {registrationOpen ? (
                  <Link
                    href="/register"
                    className="retro-btn self-start bg-accent text-accent-ink"
                  >
                    {t.paths.online.cta}
                  </Link>
                ) : (
                  <p className="font-semibold text-ink-muted">
                    {t.paths.online.closed}
                  </p>
                )}
              </PathCard>
              <PathCard
                tag={t.paths.selfHost.tag}
                title={t.paths.selfHost.title}
                text={t.paths.selfHost.text}
                points={[
                  t.paths.selfHost.point1,
                  t.paths.selfHost.point2,
                  t.paths.selfHost.point3,
                ]}
                shadow="var(--phosphor)"
              >
                <a
                  href="#install"
                  className="retro-btn self-start bg-surface text-ink"
                >
                  {t.paths.selfHost.cta}
                </a>
              </PathCard>
            </div>
          </div>
        </section>

        {/* Install */}
        <section
          id="install"
          aria-labelledby="install-title"
          className="mx-auto flex max-w-6xl scroll-mt-24 flex-wrap items-start gap-14 px-4 py-24 sm:px-6"
        >
          <div className="min-w-0 flex-[1_1_22rem]">
            <Kicker>{t.install.kicker}</Kicker>
            <h2
              id="install-title"
              className="mt-2.5 font-display text-4xl leading-[1.05] font-extrabold text-balance sm:text-5xl"
            >
              {t.install.title}
            </h2>
            <ol className="mt-8 flex flex-col gap-5">
              {[
                [t.install.step1Title, t.install.step1Text],
                [t.install.step2Title, t.install.step2Text],
                [t.install.step3Title, t.install.step3Text],
              ].map(([title, text], i) => (
                <li key={title} className="flex gap-4">
                  <span
                    aria-hidden
                    className="grid size-10 flex-none place-items-center bg-terminal font-pixel text-base text-phosphor"
                  >
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-lg font-bold">{title}</h3>
                    <p className="mt-1 leading-relaxed text-ink-muted">
                      {text}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-7 text-[15px] text-ink-muted">
              {t.install.requirements}
            </p>
          </div>

          <div className="min-w-0 flex-[1_1_34rem]">
            <div className="retro-window">
              <div className="retro-titlebar" aria-hidden>
                <span className="retro-close" />
                <span className="retro-title">{t.install.terminalTitle}</span>
              </div>
              <div className="bg-terminal px-5 pt-6 pb-7 font-terminal text-[22px] leading-snug text-phosphor sm:px-7 sm:text-[25px]">
                <div className="flex flex-wrap items-center justify-between gap-3.5">
                  <code
                    aria-label={t.install.commandLabel}
                    className="crt-text min-w-0 [overflow-wrap:anywhere] font-terminal"
                  >
                    <span aria-hidden className="text-phosphor-dim">
                      ${" "}
                    </span>
                    {command}
                  </code>
                  <CopyCommand
                    command={command}
                    labels={{
                      copy: t.install.copy,
                      copied: t.install.copied,
                      copyFailed: t.install.copyFailed,
                    }}
                  />
                </div>
                <div aria-hidden className="mt-5 text-phosphor-dim">
                  <div>{t.install.log1}</div>
                  <div>{t.install.log2}</div>
                  <div>{t.install.log3}</div>
                  <div className="crt-text text-phosphor-ok">
                    {t.install.log4}
                    <span className="crt-caret" />
                  </div>
                </div>
              </div>
            </div>
            <p className="mt-5 text-[15px] text-ink-muted">
              {rich(t.install.readFirst, {
                link: (c) => (
                  <a
                    href={installScriptUrl}
                    className={`font-semibold text-accent ${linkClass}`}
                  >
                    {c}
                  </a>
                ),
              })}{" "}
              {rich(t.install.guide, {
                link: (c) => (
                  <a
                    href={docUrl(sourceUrl, "docs/self-hosting.md")}
                    className={`font-semibold text-accent ${linkClass}`}
                  >
                    {c}
                  </a>
                ),
              })}
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t-2 border-retro-edge bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 py-9 sm:px-6">
          <span className="flex items-center gap-2">
            <LogoMark size={22} />
            <span className="font-display text-xl font-extrabold">
              orgtable
            </span>
          </span>
          <PublicFooter />
        </div>
      </footer>
    </div>
  );
}

const FEATURES = [
  { key: "boards", icon: <BoardsIcon /> },
  { key: "realtime", icon: <BoltIcon /> },
  { key: "teams", icon: <TeamIcon /> },
  { key: "calendar", icon: <CalendarIcon /> },
  { key: "api", icon: <TerminalIcon /> },
  { key: "privacy", icon: <LockIcon /> },
] as const;

function Kicker({
  children,
  tone = "accent",
}: {
  children: ReactNode;
  tone?: "accent" | "phosphor";
}) {
  return (
    <p
      className={`font-pixel text-[13px] ${tone === "accent" ? "text-accent" : "text-phosphor"}`}
    >
      {children}
    </p>
  );
}

function PathCard({
  tag,
  title,
  text,
  points,
  shadow,
  children,
}: {
  tag: string;
  title: string;
  text: string;
  points: string[];
  shadow: string;
  children: ReactNode;
}) {
  return (
    <div
      className="flex flex-col gap-4 rounded-[4px] border-2 border-retro-edge bg-surface p-8 text-ink"
      style={{ boxShadow: `8px 8px 0 ${shadow}` }}
    >
      <p className="font-pixel text-[13px] text-accent">{tag}</p>
      <h3 className="font-display text-3xl font-extrabold">{title}</h3>
      <p className="text-[17px] leading-relaxed text-ink-muted">{text}</p>
      <ul className="flex flex-col gap-2">
        {points.map((p) => (
          <li key={p} className="flex items-start gap-2.5">
            <span aria-hidden className="mt-2 size-2 flex-none bg-accent" />
            {p}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex">{children}</div>
    </div>
  );
}

/** The example board in the hero: real board and label colours of the app. */
function BoardWindow({
  t,
}: {
  t: Record<
    | "label"
    | "windowTitle"
    | "todo"
    | "doing"
    | "done"
    | `card${1 | 2 | 3 | 4 | 5 | 6}`,
    string
  >;
}) {
  const columns: {
    title: string;
    cards: {
      text: string;
      label?: string;
      progress?: number;
      done?: boolean;
      lifted?: boolean;
    }[];
  }[] = [
    {
      title: `${t.todo} · 3`,
      cards: [
        { text: t.card1, label: LABEL_COLORS.amber },
        { text: t.card2 },
        { text: t.card3, label: LABEL_COLORS.blue },
      ],
    },
    {
      title: `${t.doing} · 2`,
      cards: [
        { text: t.card4, label: LABEL_COLORS.red, progress: 60, lifted: true },
        { text: t.card5 },
      ],
    },
    { title: `${t.done} · 1`, cards: [{ text: t.card6, done: true }] },
  ];
  return (
    <figure className="retro-window" aria-label={t.label}>
      <div className="retro-titlebar" aria-hidden>
        <span className="retro-close" />
        <span className="retro-title">{t.windowTitle}</span>
      </div>
      <div
        className="grid grid-cols-1 gap-3.5 p-4 min-[30rem]:grid-cols-3 sm:p-5"
        style={{ background: BOARD_COLORS.green }}
      >
        {columns.map((col) => (
          <div
            key={col.title}
            className="flex flex-col gap-2.5 rounded-md border-2 border-retro-edge bg-surface/95 p-2.5"
          >
            <p className="font-pixel text-[11px]">{col.title}</p>
            <ul className="flex flex-col gap-2.5">
              {col.cards.map((c) => (
                <li
                  key={c.text}
                  className={`rounded-[3px] border-2 border-retro-edge bg-surface px-2.5 py-2 text-[13px] font-semibold ${
                    c.done ? "text-ink-muted line-through" : ""
                  } ${c.lifted ? "-rotate-3 shadow-[5px_5px_0_var(--retro-shadow)]" : "shadow-[2px_2px_0_var(--retro-shadow)]"}`}
                >
                  {c.label && (
                    <span
                      aria-hidden
                      className="mb-1.5 block h-1.5 w-9"
                      style={{ background: c.label }}
                    />
                  )}
                  {c.text}
                  {c.progress !== undefined && (
                    <span
                      aria-hidden
                      className="mt-2 block h-2 border-[1.5px] border-retro-edge"
                    >
                      <span
                        className="block h-full bg-accent"
                        style={{ width: `${c.progress}%` }}
                      />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </figure>
  );
}

function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" aria-hidden>
      <rect
        x="1"
        y="1"
        width="28"
        height="28"
        rx="3"
        fill="var(--accent)"
        stroke="var(--retro-edge)"
        strokeWidth="2"
      />
      <rect x="6" y="6" width="5" height="16" fill="var(--accent-ink)" />
      <rect x="12.5" y="6" width="5" height="11" fill="var(--accent-ink)" />
      <rect x="19" y="6" width="5" height="7" fill="var(--accent-ink)" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        d="M3 9h11M9 4l5 5-5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="square"
      />
    </svg>
  );
}

// Feature icons: flat pixel-ish shapes in the app's own colours.
const iconFrame = {
  fill: "var(--bg)",
  stroke: "var(--retro-edge)",
  strokeWidth: 2,
};

function BoardsIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
      <rect x="2" y="2" width="36" height="36" {...iconFrame} />
      <rect x="7" y="7" width="7" height="22" fill="var(--accent)" />
      <rect x="17" y="7" width="7" height="15" fill={LABEL_COLORS.amber} />
      <rect x="27" y="7" width="7" height="9" fill={LABEL_COLORS.green} />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
      <rect x="2" y="2" width="36" height="36" {...iconFrame} />
      <path
        d="M22 6 10 22h9l-3 12 14-18h-9z"
        fill="var(--accent)"
        stroke="var(--retro-edge)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TeamIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
      <rect x="2" y="2" width="36" height="36" {...iconFrame} />
      <circle
        cx="15"
        cy="16"
        r="5"
        fill="var(--accent)"
        stroke="var(--retro-edge)"
        strokeWidth="2"
      />
      <circle
        cx="26"
        cy="16"
        r="5"
        fill={LABEL_COLORS.blue}
        stroke="var(--retro-edge)"
        strokeWidth="2"
      />
      <path
        d="M7 33c1-6 5-8 8-8s7 2 8 8M18 33c1-6 5-8 8-8s7 2 8 8"
        fill="none"
        stroke="var(--retro-edge)"
        strokeWidth="2"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
      <rect x="2" y="5" width="36" height="33" {...iconFrame} />
      <rect x="2" y="5" width="36" height="9" fill="var(--retro-edge)" />
      <rect x="9" y="19" width="6" height="6" fill="var(--accent)" />
      <rect x="19" y="19" width="6" height="6" fill="var(--border)" />
      <rect x="29" y="19" width="5" height="6" fill="var(--border)" />
      <rect x="9" y="28" width="6" height="6" fill="var(--border)" />
      <rect x="19" y="28" width="6" height="6" fill={LABEL_COLORS.amber} />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
      <rect
        x="2"
        y="2"
        width="36"
        height="36"
        fill="var(--terminal)"
        stroke="var(--retro-edge)"
        strokeWidth="2"
      />
      <path
        d="M9 14l6 6-6 6"
        fill="none"
        stroke="var(--phosphor)"
        strokeWidth="3"
        strokeLinecap="square"
      />
      <rect x="19" y="25" width="12" height="3" fill="var(--phosphor)" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
      <rect x="2" y="2" width="36" height="36" {...iconFrame} />
      <rect
        x="11"
        y="18"
        width="18"
        height="15"
        fill="var(--accent)"
        stroke="var(--retro-edge)"
        strokeWidth="2"
      />
      <path
        d="M14 18v-4a6 6 0 0 1 12 0v4"
        fill="none"
        stroke="var(--retro-edge)"
        strokeWidth="2.4"
      />
    </svg>
  );
}
