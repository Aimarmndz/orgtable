import type { Metadata } from "next";
import Link from "next/link";
import { requireUser, verifySession } from "@/app/lib/dal";
import { prisma } from "@/app/lib/prisma";
import { getApiTokensForUser } from "@/app/lib/queries";
import { revokeApiToken } from "@/app/lib/actions/tokens";
import { revokeOtherSessions, revokeSession } from "@/app/lib/actions/account";
import { listActiveSessions } from "@/app/lib/services/account";
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

export const metadata: Metadata = {
  title: "Ajustes",
  description: "Tu perfil, tu seguridad, tus tokens de API y tus datos.",
};

// Fuera del componente: leer la hora dentro del render rompería la regla de pureza.
function isExpired(d: Date | null): boolean {
  return d !== null && d.getTime() < Date.now();
}
function now(): Date {
  return new Date();
}

const SECTIONS = [
  { id: "perfil", label: "Perfil", group: "Cuenta", icon: "user" },
  { id: "seguridad", label: "Contraseña y sesiones", group: "Cuenta", icon: "lock" },
  { id: "api", label: "Tokens de API", group: "Cuenta", icon: "code" },
  { id: "apariencia", label: "Apariencia", group: "Cuenta", icon: "moon" },
  { id: "datos", label: "Privacidad y datos", group: "Tus datos", icon: "download" },
  { id: "acerca", label: "Acerca de", group: "Tus datos", icon: "info" },
] as const;

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
        <nav aria-label="Secciones de ajustes" className="shrink-0 md:w-56">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Ajustes</h1>
          <p className="mt-1 truncate text-sm text-ink-muted" title={user.email}>
            {user.name}
          </p>
          {/* En móvil los enlaces hacen scroll horizontal; desde md, columna. */}
          <div className="-mx-4 mt-5 flex gap-1 overflow-x-auto px-4 md:mx-0 md:block md:overflow-visible md:px-0">
            {groups.map((group) => (
              <div key={group} className="contents md:mt-5 md:block md:first:mt-0">
                <p className="mb-1.5 hidden px-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted md:block">
                  {group}
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
                        {s.label}
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
            id="perfil"
            title="Perfil"
            description="Así te ven las personas con las que compartes tableros."
          >
            <ProfileForm name={user.name} email={user.email} />
          </Section>

          <Section
            id="seguridad"
            title="Contraseña y sesiones"
            description="Al cambiar la contraseña se cierran tus otras sesiones."
          >
            <PasswordForm />

            <h3 className="mb-2.5 mt-8 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
              Sesiones abiertas
            </h3>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {sessions.map((s) => {
                const current = s.id === session?.sessionId;
                return (
                  <li key={s.id} className="flex items-center gap-3 bg-surface px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {describeUserAgent(s.userAgent)}
                        {current && (
                          <span className="rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                            Esta sesión
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-ink-muted">
                        iniciada {formatDate(s.createdAt)} · caduca {formatDate(s.expiresAt)}
                      </p>
                    </div>
                    {!current && (
                      <form action={revokeSession}>
                        <input type="hidden" name="sessionId" value={s.id} />
                        <button className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10">
                          Cerrar
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
                  Cerrar las otras {otherSessions === 1 ? "sesión" : `${otherSessions} sesiones`}
                </button>
              </form>
            )}
          </Section>

          <Section
            id="api"
            title="Tokens de API"
            description={
              <>
                Para usar la API de orgtable desde scripts u otras aplicaciones. Un token
                actúa <strong>como tú</strong>, con tu mismo acceso a los tableros, y solo se
                muestra una vez. Consulta la{" "}
                <a
                  href={`${sourceCodeUrl()}/blob/main/docs/api/public-api.md`}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  documentación de la API
                </a>
                .
              </>
            }
          >
            <CreateTokenForm />

            {tokens.length === 0 ? (
              <p className="mt-6 text-sm text-ink-muted">Aún no has creado ningún token.</p>
            ) : (
              <ul className="mt-6 divide-y divide-border overflow-hidden rounded-xl border border-border">
                {tokens.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 bg-surface px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{t.name}</span>
                        <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                          {t.scope === "read" ? "Solo lectura" : "Escritura"}
                        </span>
                        {isExpired(t.expiresAt) && (
                          <span className="shrink-0 rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">
                            Caducado
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-ink-muted">
                        {t.prefix}… · creado {formatDate(t.createdAt)} ·{" "}
                        {t.expiresAt ? `caduca ${formatDate(t.expiresAt)}` : "no caduca"} ·{" "}
                        {t.lastUsedAt ? `usado ${formatDate(t.lastUsedAt)}` : "sin usar"}
                      </p>
                    </div>
                    <form action={revokeApiToken}>
                      <input type="hidden" name="id" value={t.id} />
                      <button className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10">
                        Revocar
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            id="apariencia"
            title="Apariencia"
            description="Se guarda en este navegador."
          >
            <ThemePicker />
          </Section>

          <Section
            id="datos"
            title="Privacidad y datos"
            description={
              <>
                Tus derechos del RGPD, sin tener que escribir a nadie. El detalle está en la{" "}
                <Link
                  href="/legal/privacidad"
                  className="text-accent underline-offset-2 hover:underline"
                >
                  política de privacidad
                </Link>
                .
              </>
            }
          >
            <div className="flex flex-col gap-4 rounded-xl bg-surface-2 p-4 sm:flex-row sm:items-center">
              <div className="flex-1">
                <p className="text-sm font-semibold">Descargar mis datos</p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  Un archivo JSON con tu cuenta, tus tableros, tus comentarios, tus
                  notificaciones y tu registro de seguridad.
                </p>
              </div>
              {/* Enlace normal (no fetch): el navegador descarga el archivo con su nombre. */}
              <a
                href="/api/account/export"
                download
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium transition hover:bg-bg active:translate-y-px"
              >
                Descargar .json
              </a>
            </div>

            <div className="mt-4 rounded-xl border border-danger/35 p-4 sm:p-5">
              <h3 className="text-sm font-bold text-danger">Borrar mi cuenta</h3>
              <p className="mt-1 mb-4 text-sm text-ink-muted">
                Se borran para siempre tu cuenta,{" "}
                {ownedBoards === 0
                  ? "tus comentarios"
                  : `${ownedBoards === 1 ? "el tablero que creaste" : `los ${ownedBoards} tableros que creaste`} (con sus tarjetas y adjuntos) y tus comentarios`}
                . Los tableros de otras personas siguen, sin ti. No se puede deshacer.
              </p>
              <DeleteAccountForm />
            </div>
          </Section>

          <Section id="acerca" title="Acerca de" tone="plain">
            <div className="flex flex-col gap-2 text-sm text-ink-muted sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <p>
                orgtable <span className="font-mono">{APP_VERSION}</span> ·{" "}
                <a href={sourceCodeUrl()} className="text-accent underline-offset-2 hover:underline">
                  Código fuente
                </a>{" "}
                · Licencia{" "}
                <a href={LICENSE_URL} className="text-accent underline-offset-2 hover:underline">
                  {LICENSE_NAME}
                </a>
              </p>
              {/* Atribución exigida por LICENSE (términos 7(b)): no se quita en derivados. */}
              <p>
                Created by{" "}
                <a href={AUTHOR_URL} className="text-accent underline-offset-2 hover:underline">
                  {AUTHOR_NAME}
                </a>
              </p>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
