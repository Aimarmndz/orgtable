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
import { ThemeToggle } from "@/app/components/theme-toggle";
import { SearchBox } from "@/app/components/search-box";
import { NotificationsBell } from "@/app/components/notifications-bell";
import { AccountMenu } from "@/app/components/account-menu";

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
    <div className="flex flex-1 flex-col">
      <header className="relative z-20 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface/80 px-3 backdrop-blur-sm sm:px-4">
        <Link href="/boards" className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent font-display text-sm font-extrabold text-accent-ink">
            o
          </span>
          {/* title: el nombre admite 60 caracteres y en móvil se trunca. */}
          <span
            title={config?.instanceName ?? "orgtable"}
            className="truncate font-display font-bold tracking-tight"
          >
            {config?.instanceName ?? "orgtable"}
          </span>
        </Link>

        {/* Búsqueda — centrada y solo en pantallas medianas hacia arriba; en móvil se
            llega a /search desde el icono de la derecha. */}
        <div className="mx-6 hidden max-w-sm flex-1 sm:block">
          <SearchBox />
        </div>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
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
          <NotificationsBell
            notifications={notifications.map((n) => ({
              ...n,
              createdAt: n.createdAt.toISOString(),
            }))}
            unreadCount={unreadCount}
          />
          <ThemeToggle />
          <AccountMenu
            name={user.name}
            email={user.email}
            isAdmin={user.role === "ADMIN"}
          />
        </div>
      </header>
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
