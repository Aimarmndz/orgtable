"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

// Side navigation of the settings and administration areas (DESIGN.md, "Settings and
// administration"). The current page is marked with aria-current. On small screens the
// sections scroll as a row above the content, unless the area has an index page
// (`mobileIndex`): then the index lists the sections as rows and every other page shows a
// single "back to the index" link instead of the row, as in the mobile design.

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
  mobileIndex,
}: {
  groups: SideNavGroup[];
  label: string;
  dark?: boolean;
  mobileIndex?: { href: string; label: string };
}) {
  const pathname = usePathname();
  const isCurrent = (item: SideNavItem) =>
    item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`);
  const onIndex = mobileIndex ? pathname === mobileIndex.href : false;
  return (
    <>
      {mobileIndex && !onIndex && (
        <Link
          href={mobileIndex.href}
          className="flex min-h-11 items-center gap-1.5 border-b border-border bg-surface-2/60 px-4 text-sm font-semibold text-ink md:hidden"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="size-[18px]"
            aria-hidden
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
          {mobileIndex.label}
        </Link>
      )}
      {/* data-menu-nav: the app's right-click menu offers these sections too. */}
      <nav
        aria-label={label}
        data-menu-nav=""
        className={`${mobileIndex ? "hidden md:flex" : "flex"} gap-1 overflow-x-auto md:flex-col md:overflow-visible`}
      >
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
                  {item.icon && (
                    <span aria-hidden className="grid size-[18px] place-items-center">
                      {item.icon}
                    </span>
                  )}
                  {item.label}
                  {item.badge && (
                    <span
                      className={`ml-auto pl-3 text-xs ${dark ? "text-white/50" : "text-ink-muted"}`}
                    >
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </>
  );
}
