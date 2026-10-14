import Link from "next/link";
import { logout } from "@/app/lib/actions/auth";
import { initials } from "@/app/lib/initials";

// Menú de la cuenta en la barra superior: quién eres, ajustes, privacidad, administración
// (solo admins) y salir. Usa la API `popover` del navegador: abre y cierra sin JavaScript
// propio, se cierra al pulsar fuera o con Escape y el botón expone su estado a los
// lectores de pantalla. Sin "use client": es HTML puro.

const ITEM =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none";

function Icon({ d }: { d: React.ReactNode }) {
  return (
    <svg
      className="size-4 shrink-0 text-ink-muted"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d}
    </svg>
  );
}

export function AccountMenu({
  name,
  email,
  isAdmin,
}: {
  name: string;
  email: string;
  isAdmin: boolean;
}) {
  return (
    <>
      <button
        type="button"
        popoverTarget="account-menu"
        aria-label={`Tu cuenta: ${name}`}
        className="ml-1 grid size-9 place-items-center rounded-full bg-accent text-xs font-bold text-accent-ink transition hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [anchor-name:--account-menu]"
      >
        {initials(name)}
      </button>
      <div
        id="account-menu"
        popover="auto"
        className="account-menu m-0 w-64 rounded-xl border border-border bg-surface p-1.5 text-ink shadow-[0_16px_40px_-12px_oklch(0.27_0.022_52/0.35)]"
      >
        <div className="px-2.5 pb-2 pt-1.5">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="truncate text-xs text-ink-muted">{email}</p>
        </div>
        <div className="my-1 h-px bg-border" />
        <Link href="/settings#perfil" className={ITEM}>
          <Icon d={<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>} />
          Perfil y ajustes
        </Link>
        <Link href="/settings#seguridad" className={ITEM}>
          <Icon d={<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>} />
          Contraseña y sesiones
        </Link>
        <Link href="/settings#datos" className={ITEM}>
          <Icon d={<path d="M12 3v12M7 10l5 5 5-5M5 21h14" />} />
          Privacidad y datos
        </Link>
        {isAdmin && (
          <Link href="/admin/users" className={ITEM}>
            <Icon d={<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />} />
            Administración
          </Link>
        )}
        <div className="my-1 h-px bg-border" />
        <form action={logout}>
          <button type="submit" className={ITEM}>
            <Icon d={<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />} />
            Cerrar sesión
          </button>
        </form>
      </div>
    </>
  );
}
