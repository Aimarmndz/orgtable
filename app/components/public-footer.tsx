import Link from "next/link";
import {
  AUTHOR_NAME,
  AUTHOR_URL,
  LICENSE_NAME,
  LICENSE_URL,
  sourceCodeUrl,
} from "@/app/lib/site";

// Pie de las páginas públicas (login, registro, asistente inicial y páginas legales). Es
// donde LICENSE (términos 7(b)) exige mostrar «Created by Aimar»: no lo quites en una
// versión derivada. El enlace al código cumple la sección 13 de la AGPL.
export function PublicFooter({ className = "" }: { className?: string }) {
  const linkClass =
    "rounded-sm underline-offset-2 transition-colors hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  return (
    <footer
      className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-ink-muted ${className}`}
    >
      <nav aria-label="Información legal" className="contents">
        <Link href="/legal/privacidad" className={linkClass}>
          Privacidad
        </Link>
        <Link href="/legal/condiciones" className={linkClass}>
          Condiciones
        </Link>
        <Link href="/legal/cookies" className={linkClass}>
          Cookies
        </Link>
        <Link href="/legal/aviso-legal" className={linkClass}>
          Aviso legal
        </Link>
      </nav>
      <a href={sourceCodeUrl()} className={linkClass}>
        Código fuente
      </a>
      <a href={LICENSE_URL} className={linkClass}>
        {LICENSE_NAME}
      </a>
      <span>
        Created by{" "}
        <a href={AUTHOR_URL} className={linkClass}>
          {AUTHOR_NAME}
        </a>
      </span>
    </footer>
  );
}
