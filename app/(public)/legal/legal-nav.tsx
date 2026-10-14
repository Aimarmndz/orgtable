"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PAGES = [
  { href: "/legal/privacidad", label: "Privacidad" },
  { href: "/legal/condiciones", label: "Condiciones de uso" },
  { href: "/legal/cookies", label: "Cookies" },
  { href: "/legal/aviso-legal", label: "Aviso legal" },
] as const;

// Índice lateral de las páginas legales. Cliente solo para marcar la página actual.
export function LegalNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Páginas legales" className="shrink-0 md:w-48">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
        Legal
      </p>
      <ul className="flex flex-wrap gap-1 md:flex-col">
        {PAGES.map((p) => {
          const current = pathname === p.href;
          return (
            <li key={p.href}>
              <Link
                href={p.href}
                aria-current={current ? "page" : undefined}
                className={`block rounded-lg px-2.5 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                  current
                    ? "bg-surface-2 font-semibold text-ink"
                    : "text-ink-muted hover:bg-surface-2 hover:text-ink"
                }`}
              >
                {p.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
