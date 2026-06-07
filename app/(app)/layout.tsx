import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getInstanceConfig,
  isSetupComplete,
  requireUser,
} from "@/app/lib/dal";
import {
  getNotificationsForUser,
  getUnreadNotificationCount,
} from "@/app/lib/queries";
import { logout } from "@/app/lib/actions/auth";
import { ThemeToggle } from "@/app/components/theme-toggle";
import { SearchBox } from "@/app/components/search-box";
import { NotificationsBell } from "@/app/components/notifications-bell";
import { Button } from "@/app/components/ui/button";

// Todo el área autenticada depende de la sesión y de la base de datos: nunca se
// prerenderiza en build (la consulta de setup ocurre antes del acceso a cookies, así
// que hay que marcarlo explícitamente para que el build de Docker no toque la DB).
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isSetupComplete())) redirect("/setup");
  const user = await requireUser();
  const [config, notifications, unreadCount] = await Promise.all([
    getInstanceConfig(),
    getNotificationsForUser(user.id),
    getUnreadNotificationCount(user.id),
  ]);

  return (
    <div className="flex min-h-full flex-col">
      <header className="relative z-20 flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface/80 px-4 backdrop-blur-sm">
        <Link href="/boards" className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-md bg-accent font-display text-sm font-extrabold text-accent-ink">
            o
          </span>
          <span className="font-display font-bold tracking-tight">
            {config?.instanceName ?? "orgtable"}
          </span>
        </Link>

        {/* Búsqueda — centrada y solo en pantallas medianas hacia arriba; en móvil se
            llega a /search desde el icono de la derecha. */}
        <div className="mx-6 hidden max-w-sm flex-1 sm:block">
          <SearchBox />
        </div>

        <div className="flex items-center gap-1">
          <Link
            href="/search"
            aria-label="Buscar"
            className="grid size-9 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink sm:hidden"
          >
            <svg
              className="size-[18px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
          </Link>
          {user.role === "ADMIN" && (
            <Link
              href="/admin/users"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              Administración
            </Link>
          )}
          <NotificationsBell
            notifications={notifications.map((n) => ({
              ...n,
              createdAt: n.createdAt.toISOString(),
            }))}
            unreadCount={unreadCount}
          />
          <Link
            href="/settings"
            aria-label="Ajustes"
            className="grid size-9 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <svg
              className="size-[18px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
          <ThemeToggle />
          <span className="mx-2 hidden text-sm text-ink-muted sm:inline">
            {user.email}
          </span>
          <form action={logout}>
            <Button variant="ghost" type="submit">
              Salir
            </Button>
          </form>
        </div>
      </header>
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
