import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getInstanceConfig,
  isSetupComplete,
  requireUser,
} from "@/app/lib/dal";
import { logout } from "@/app/lib/actions/auth";
import { ThemeToggle } from "@/app/components/theme-toggle";
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
  const config = await getInstanceConfig();

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
        <div className="flex items-center gap-1">
          {user.role === "ADMIN" && (
            <Link
              href="/admin/users"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
            >
              Administración
            </Link>
          )}
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
