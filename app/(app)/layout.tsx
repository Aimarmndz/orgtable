import Link from "next/link";
import { redirect } from "next/navigation";
import { isSetupComplete, requireUser } from "@/app/lib/dal";
import {
  getNotificationsForUser,
  getUnreadNotificationCount,
  getWorkspacesForUser,
} from "@/app/lib/queries";
import { ThemeToggle } from "@/app/components/theme-toggle";
import { SearchBox } from "@/app/components/search-box";
import { NotificationsBell } from "@/app/components/notifications-bell";
import { AccountMenu } from "@/app/components/account-menu";
import { WorkspaceSwitcher } from "@/app/components/workspace-switcher";
import { getI18n } from "@/app/i18n/server";

// The whole signed-in area depends on the session and the database, so it is never
// prerendered at build time. The setup query runs before any cookie access, so this must
// be explicit or the Docker build would try to reach the DB.
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isSetupComplete())) redirect("/setup");
  const user = await requireUser();
  const [{ m }, workspaces, notifications, unreadCount] = await Promise.all([
    getI18n(),
    getWorkspacesForUser(user.id),
    getNotificationsForUser(user.id),
    getUnreadNotificationCount(user.id),
  ]);

  const switcher = workspaces.map((w) => ({
    id: w.id,
    slug: w.slug,
    name: w.name,
    kind: w.kind,
    brandColor: w.brandColor,
    logoStoredName: w.logoStoredName,
  }));

  return (
    <div className="flex flex-1 flex-col">
      <header className="relative z-20 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface/80 px-3 backdrop-blur-sm sm:px-4">
        <WorkspaceSwitcher workspaces={switcher} />

        {/* Search: centred, and only from medium screens up; on mobile /search is
            reached from the icon on the right. */}
        <div className="mx-6 hidden max-w-sm flex-1 sm:block">
          <SearchBox />
        </div>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          <Link
            href="/search"
            aria-label={m.nav.search.label}
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
            organizations={workspaces.filter((w) => w.kind === "ORGANIZATION")}
          />
        </div>
      </header>
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  );
}
