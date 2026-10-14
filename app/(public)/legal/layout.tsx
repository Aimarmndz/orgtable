import Link from "next/link";
import { verifySession } from "@/app/lib/dal";
import { PublicFooter } from "@/app/components/public-footer";
import { LegalNav } from "./legal-nav";

// Páginas legales públicas (/legal/*): se leen sin sesión, también desde el registro. El
// texto describe lo que hace ESTE código y los datos del responsable salen de los ajustes
// de la instancia (/admin/instance), así que valen para la instancia oficial y para
// cualquier instancia autoalojada. Ver docs/privacy.md.

export const dynamic = "force-dynamic";

export default async function LegalLayout({ children }: { children: React.ReactNode }) {
  const session = await verifySession();
  return (
    <div className="flex min-h-[100dvh] flex-1 flex-col">
      <header className="relative z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur-sm sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
          <span className="grid size-7 place-items-center rounded-md bg-accent font-display text-sm font-extrabold text-accent-ink">
            o
          </span>
          <span className="font-display font-bold tracking-tight">orgtable</span>
        </Link>
        <Link
          href={session ? "/boards" : "/login"}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-accent transition-colors hover:bg-surface-2"
        >
          {session ? "Ir a tus tableros" : "Iniciar sesión"}
        </Link>
      </header>
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:gap-12 md:py-14">
        <LegalNav />
        <article className="legal-prose min-w-0 max-w-[68ch] flex-1">{children}</article>
      </div>
      <PublicFooter className="border-t border-border px-4 py-5" />
    </div>
  );
}
