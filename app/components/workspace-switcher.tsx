"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { NavIcon } from "@/app/components/settings/nav-icons";
import { WorkspaceAvatar } from "@/app/components/workspace/workspace-avatar";
import { useI18n } from "@/app/i18n/client";
import { fmt } from "@/app/i18n/format";

// Top-left of the bar: the workspace you are in (taken from the first segment of the URL)
// and a menu to go to another one or to its settings. It replaces a logo that always led to
// /boards and took people out of their organization. Native popover, like the account menu;
// client only to read the path. See docs/workspaces.md.

export type SwitcherWorkspace = {
  id: string;
  slug: string;
  name: string;
  kind: "PERSONAL" | "ORGANIZATION";
  brandColor: string | null;
  logoStoredName: string | null;
};

const ITEM =
  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none";

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden="true" className="grid size-4 shrink-0 place-items-center text-ink-muted [&>svg]:size-4">
      {children}
    </span>
  );
}

export function WorkspaceSwitcher({ workspaces }: { workspaces: SwitcherWorkspace[] }) {
  const { m } = useI18n();
  const t = m.nav.switcher;
  const pathname = usePathname();
  const popover = useRef<HTMLDivElement>(null);
  const segment = pathname.split("/")[1] ?? "";
  const current = workspaces.find((w) => w.slug === segment) ?? null;
  const nameOf = (w: SwitcherWorkspace) => (w.kind === "PERSONAL" ? t.personal : w.name);
  // A client-side navigation keeps the bar mounted, so the popover would stay open.
  const hide = () => popover.current?.hidePopover();

  return (
    <>
      <button
        type="button"
        popoverTarget="workspace-switcher"
        aria-label={fmt(t.label, { name: current ? nameOf(current) : t.allBoards })}
        className="flex min-w-0 items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [anchor-name:--workspace-switcher]"
      >
        {current ? (
          <WorkspaceAvatar workspace={current} size={28} />
        ) : (
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent font-display text-sm font-extrabold text-accent-ink">
            o
          </span>
        )}
        {/* title: an organization name allows 60 characters and is truncated on mobile. */}
        <span
          title={current ? nameOf(current) : t.allBoards}
          className="truncate font-display font-bold tracking-tight"
        >
          {current ? nameOf(current) : t.allBoards}
        </span>
        <svg
          className="size-4 shrink-0 text-ink-muted"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div
        ref={popover}
        id="workspace-switcher"
        popover="auto"
        className="workspace-switcher m-0 w-72 rounded-xl border border-border bg-surface p-1.5 text-ink shadow-[0_16px_40px_-12px_oklch(0.27_0.022_52/0.35)]"
      >
        <p className="px-2.5 pb-1.5 pt-2 text-[10.5px] font-bold uppercase tracking-[0.09em] text-ink-muted">
          {t.heading}
        </p>
        {workspaces.map((w) => (
          <Link
            key={w.id}
            href={`/${w.slug}`}
            onClick={hide}
            aria-current={w.id === current?.id ? "page" : undefined}
            className={ITEM}
          >
            <WorkspaceAvatar workspace={w} size={24} />
            <span className="min-w-0 flex-1 truncate">{nameOf(w)}</span>
            <span className="shrink-0 font-mono text-xs text-ink-muted">/{w.slug}</span>
            {w.id === current?.id && (
              <svg
                className="size-4 shrink-0 text-accent"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5 12l5 5 9-10" />
              </svg>
            )}
          </Link>
        ))}
        <Link href="/boards" onClick={hide} className={ITEM}>
          <Icon>{NavIcon.boards}</Icon>
          {t.allBoards}
        </Link>
        <div className="my-1 h-px bg-border" />
        {current?.kind === "ORGANIZATION" && (
          <Link href={`/${current.slug}/settings`} onClick={hide} className={ITEM}>
            <Icon>{NavIcon.general}</Icon>
            {fmt(t.settingsOf, { name: current.name })}
          </Link>
        )}
        <Link href="/settings/workspaces" onClick={hide} className={ITEM}>
          <Icon>{NavIcon.building}</Icon>
          {t.createOrg}
        </Link>
      </div>
    </>
  );
}
