"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Side navigation of the settings and administration areas (DESIGN.md, "Settings and
// administration"). The current page is marked with aria-current; on small screens the
// sections scroll as a row above the content.

export type SideNavItem = {
  href: string;
  label: string;
  icon?: ReactNode;
  badge?: string;
  tone?: "danger";
  // Matches the current page exactly instead of by prefix.
  exact?: boolean;
};

export type SideNavGroup = { label?: string; items: SideNavItem[] };

export function SideNav({
  groups,
  label,
  dark = false,
}: {
  groups: SideNavGroup[];
  label: string;
  dark?: boolean;
}) {
  const pathname = usePathname();
  const isCurrent = (item: SideNavItem) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
  return (
    <nav aria-label={label} className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
      {groups.map((group, i) => (
        <div key={i} className="flex shrink-0 gap-1 md:flex-col">
          {group.label && (
            <p
              className={`hidden px-3 pb-1.5 pt-3 text-[11px] font-bold uppercase tracking-[0.08em] md:block ${
                dark ? "text-white/50" : "text-ink-muted"
              } ${i === 0 ? "md:pt-0" : ""}`}
            >
              {group.label}
            </p>
          )}
          {group.items.map((item) => {
            const current = isCurrent(item);
            const base =
              "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
            const tone = dark
              ? current
                ? "bg-white/10 text-white"
                : item.tone === "danger"
                  ? "text-red-300 hover:bg-white/5"
                  : "text-white/75 hover:bg-white/5 hover:text-white"
              : current
                ? "bg-surface font-semibold text-ink shadow-sm ring-1 ring-border"
                : item.tone === "danger"
                  ? "text-danger hover:bg-danger/5"
                  : "text-ink-muted hover:bg-surface hover:text-ink";
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`${base} ${tone}`}
              >
                {item.icon && <span aria-hidden className="grid size-[18px] place-items-center">{item.icon}</span>}
                {item.label}
                {item.badge && (
                  <span className={`ml-auto pl-3 text-xs ${dark ? "text-white/50" : "text-ink-muted"}`}>
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
