"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/app/i18n/client";

// Side index of the legal pages. A Client Component only to mark the current page.
export function LegalNav() {
  const pathname = usePathname();
  const { m } = useI18n();
  const t = m.legal.nav;
  const pages = [
    { href: "/legal/privacy", label: t.privacy },
    { href: "/legal/terms", label: t.terms },
    { href: "/legal/cookies", label: t.cookies },
    { href: "/legal/notice", label: t.legalNotice },
  ];
  return (
    <nav aria-label={t.label} className="shrink-0 md:w-48">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
        {t.heading}
      </p>
      <ul className="flex flex-wrap gap-1 md:flex-col">
        {pages.map((p) => {
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
