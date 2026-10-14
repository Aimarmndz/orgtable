import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isSetupComplete, verifySession } from "@/app/lib/dal";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage() {
  // Si aún no se ha configurado la instancia, el primer paso es el wizard.
  if (!(await isSetupComplete())) redirect("/setup");
  if (await verifySession()) redirect("/boards");

  return (
    <main className="grid min-h-[100dvh] flex-1 lg:grid-cols-[1.1fr_1fr]">
      {/* Panel de marca — solo en pantallas anchas. Acento terracota, display grande. */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-accent p-12 text-accent-ink lg:flex">
        {/* Arcos concéntricos sutiles como textura de fondo (no decorativa en exceso). */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 -top-40 size-[34rem] rounded-full border border-accent-ink/15"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-52 -left-32 size-[40rem] rounded-full border border-accent-ink/10"
        />

        <div className="relative flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-accent-ink/15 font-display text-lg font-extrabold">
            o
          </span>
          <span className="font-display text-lg font-bold tracking-tight">
            orgtable
          </span>
        </div>

        <div className="relative max-w-md">
          <h2 className="font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-balance">
            Tu trabajo, en columnas que respiran.
          </h2>
          <p className="mt-5 max-w-sm leading-relaxed text-accent-ink/80">
            Tableros Kanban self-hosted. Tus datos en tu servidor, sin terceros
            mirando.
          </p>
        </div>

        <p className="relative font-mono text-xs uppercase tracking-widest text-accent-ink/60">
          Kanban · Self-hosted
        </p>
      </aside>

      {/* Formulario */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <LoginForm />
      </div>
    </main>
  );
}
