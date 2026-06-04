import Link from "next/link";
import { redirect } from "next/navigation";
import { isSetupComplete, requireUser } from "@/app/lib/dal";
import { logout } from "@/app/lib/actions/auth";

// Todo el área autenticada depende de la sesión y de la base de datos: nunca se
// prerenderiza en build (la consulta de setup ocurre antes del acceso a cookies, así
// que hay que marcarlo explícitamente para que el build de Docker no toque la DB).
export const dynamic = "force-dynamic";

// Layout del área autenticada. Es la frontera de seguridad SEGURA (a diferencia del
// proxy, que es optimista): valida la sesión en cada render vía el DAL.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isSetupComplete())) redirect("/setup");
  const user = await requireUser();

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b border-black/10 bg-white px-6 py-3">
        <Link href="/boards" className="text-lg font-bold tracking-tight">
          orgtable
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-zinc-500">{user.email}</span>
          <form action={logout}>
            <button className="rounded-md px-3 py-1.5 font-medium text-zinc-600 transition hover:bg-zinc-100">
              Salir
            </button>
          </form>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
