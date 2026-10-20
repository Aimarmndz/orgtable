"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ContextMenu, type MenuEntry, type MenuItem } from "@/app/components/board/context-menu";
import type { SwitcherWorkspace } from "@/app/components/workspace-switcher";
import { useI18n } from "@/app/i18n/client";
import { fmt } from "@/app/i18n/format";

// orgtable's right-click menu (and long press on touch) everywhere outside the board, which
// has its own (board-menu.tsx). What was under the pointer decides the first section:
// - a scope, any element with data-menu-scope (a board tile, a settings row, a label, a
//   comment…): the buttons and links inside it, the same actions they already run, so
//   nothing here bypasses a confirmation or a permission. data-menu-title names it;
//   data-menu-label renames one control; data-menu-skip hides one; data-menu-copy adds
//   "Copy text" with that text;
// - a link: open, open in a new tab, copy link.
// Then the page: back, copy its link, and where to go (the workspace you are in, its
// settings, all boards, search, your settings). Fields, selected text and Shift + right
// click keep the browser's own menu. See docs/board-menu.md, "Outside the board".

type State = { at: { x: number; y: number }; mode: "popover" | "sheet"; title: string; entries: MenuEntry[]; key: number };

const CONTROL = "button, a[href]";

export function AppContextMenu({ workspaces }: { workspaces: SwitcherWorkspace[] }) {
  const { m } = useI18n();
  const t = m.nav.contextMenu;
  const router = useRouter();
  const pathname = usePathname();
  const [menu, setMenu] = useState<State | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number; openedAt: number }>({
    timer: null,
    x: 0,
    y: 0,
    openedAt: 0,
  });

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 2200);
    return () => clearTimeout(id);
  }, [notice]);

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(done);
    } catch {
      setNotice(t.copyFailed);
    }
  }

  const segment = pathname.split("/")[1] ?? "";
  const current = workspaces.find((w) => w.slug === segment) ?? null;

  // An effect event: built from the latest render while the listeners are attached once.
  const build = useEffectEvent((target: Element): { title: string; entries: MenuEntry[] } => {
    const entries: MenuEntry[] = [];
    const scope = target.closest<HTMLElement>("[data-menu-scope]");
    const link = target.closest<HTMLAnchorElement>("a[href]");
    let title = "";

    if (scope) {
      title = scope.dataset.menuTitle ?? firstLine(scope);
      const primary = scope.matches("a[href]") ? (scope as HTMLAnchorElement) : scope.querySelector<HTMLAnchorElement>("a[href]");
      if (primary) entries.push(...linkItems(primary, "scope"));
      const seen = new Set<string>();
      for (const el of scope.querySelectorAll<HTMLElement>(CONTROL)) {
        if (el === primary || el.hasAttribute("data-menu-skip") || (el as HTMLButtonElement).disabled) continue;
        if (el.closest("[data-menu-scope]") !== scope) continue;
        const label = controlLabel(el);
        if (!label || seen.has(label)) continue;
        seen.add(label);
        entries.push({
          kind: "item",
          id: `control-${entries.length}`,
          label,
          danger: el.hasAttribute("data-menu-danger") || /\b(text-danger|bg-danger)\b/.test(el.className),
          onSelect: () => el.click(),
        });
      }
      if (scope.dataset.menuCopy)
        entries.push({
          kind: "item",
          id: "copy-text",
          label: t.copyText,
          onSelect: () => void copy(scope.dataset.menuCopy!, t.textCopied),
        });
    } else if (link) {
      title = firstLine(link) || link.getAttribute("aria-label") || "";
      entries.push(...linkItems(link, "link"));
    }

    const page: MenuItem[] = [
      { kind: "item", id: "back", label: t.goBack, onSelect: () => router.back() },
      { kind: "item", id: "refresh", label: t.refresh, onSelect: () => router.refresh() },
      {
        kind: "item",
        id: "copy-page",
        label: t.copyPageLink,
        onSelect: () => void copy(location.href, t.linkCopied),
      },
      {
        kind: "item",
        id: "theme",
        label: t.theme,
        onSelect: () => document.querySelector<HTMLButtonElement>("[data-theme-toggle]")?.click(),
      },
    ];
    // The sections of the side menu (settings, administration), one jump away.
    const nav = document.querySelector<HTMLElement>("[data-menu-nav]");
    const sections: MenuItem[] = nav
      ? [...nav.querySelectorAll<HTMLAnchorElement>("a[href]")].map((a, i) => ({
          kind: "item" as const,
          id: `section-${i}`,
          label: firstLine(a),
          checked: a.getAttribute("aria-current") === "page",
          role: "menuitemradio" as const,
          onSelect: () => a.click(),
        }))
      : [];
    const sectionsItem: MenuEntry[] = sections.length
      ? [
          {
            kind: "item",
            id: "sections",
            label: nav?.getAttribute("aria-label") ?? t.goTo,
            submenu: { id: "sections", title: nav?.getAttribute("aria-label") ?? t.goTo, entries: sections },
          },
        ]
      : [];
    const go: MenuItem[] = [];
    if (current) {
      go.push({
        kind: "item",
        id: "go-workspace",
        label: current.kind === "PERSONAL" ? m.nav.switcher.personal : current.name,
        onSelect: () => router.push(`/${current.slug}`),
      });
      if (current.kind === "ORGANIZATION")
        go.push({
          kind: "item",
          id: "go-org-settings",
          label: fmt(m.nav.switcher.settingsOf, { name: current.name }),
          onSelect: () => router.push(`/${current.slug}/settings`),
        });
    }
    go.push(
      { kind: "item", id: "go-boards", label: m.nav.switcher.allBoards, onSelect: () => router.push("/boards") },
      { kind: "item", id: "go-search", label: t.search, onSelect: () => router.push("/search") },
      { kind: "item", id: "go-settings", label: t.yourSettings, onSelect: () => router.push("/settings/profile") },
    );

    if (entries.length === 0) {
      // Nothing specific under the pointer: the page is the menu.
      return {
        title: t.page,
        entries: [
          ...page,
          { kind: "separator", id: "sep-go" },
          ...sectionsItem,
          { kind: "item", id: "go", label: t.goTo, submenu: { id: "go", title: t.goTo, entries: go } },
        ],
      };
    }
    return {
      title: title || t.label,
      entries: [
        ...entries,
        { kind: "separator", id: "sep-page" },
        { kind: "item", id: "page", label: t.page, submenu: { id: "page", title: t.page, entries: page } },
        ...sectionsItem,
        { kind: "item", id: "go", label: t.goTo, submenu: { id: "go", title: t.goTo, entries: go } },
      ],
    };

    function linkItems(a: HTMLAnchorElement, prefix: string): MenuItem[] {
      const href = a.href;
      const download = a.hasAttribute("download") || a.pathname.startsWith("/api/");
      return [
        {
          kind: "item",
          id: `${prefix}-open`,
          label: t.open,
          onSelect: () => a.click(),
        },
        ...(download
          ? []
          : [
              {
                kind: "item" as const,
                id: `${prefix}-new-tab`,
                label: t.openNewTab,
                onSelect: () => window.open(href, "_blank", "noopener,noreferrer"),
              },
            ]),
        {
          kind: "item",
          id: `${prefix}-copy`,
          label: t.copyLink,
          onSelect: () => void copy(href, t.linkCopied),
        },
      ];
    }
  });

  useEffect(() => {
    const p = press.current;
    const native = (el: Element, shift: boolean) =>
      shift ||
      Boolean(el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) ||
      Boolean(window.getSelection()?.toString().trim());

    function open(target: Element, at: { x: number; y: number }, mode: "popover" | "sheet") {
      const { title, entries } = build(target);
      setMenu((prev) => ({ at, mode, title, entries, key: (prev?.key ?? 0) + 1 }));
    }

    function onContextMenu(e: MouseEvent) {
      // The board (and the card on top of it) open their own menu and prevent the default.
      if (e.defaultPrevented) return;
      const el = e.target instanceof Element ? e.target : null;
      if (!el || native(el, e.shiftKey)) return;
      e.preventDefault();
      if (Date.now() - p.openedAt < 800) return;
      let at = { x: e.clientX, y: e.clientY };
      // Ctrl + click on a Mac arrives as button 0: it is still a pointer.
      if (e.button !== 2 && !e.ctrlKey) {
        // From the keyboard (context-menu key, Shift+F10): next to the focused element.
        const r = el.getBoundingClientRect();
        at = { x: r.left + 12, y: r.top + Math.min(r.height, 32) };
      }
      open(el, at, "popover");
    }
    // Touch: iOS has no contextmenu event, so holding for half a second opens the sheet.
    function onPointerDown(e: PointerEvent) {
      if (p.timer) clearTimeout(p.timer);
      p.timer = null;
      const el = e.target instanceof Element ? e.target : null;
      // The board handles its own long press (board-view.tsx).
      if (e.pointerType !== "touch" || !el || native(el, false) || el.closest("[data-own-menu]")) return;
      p.x = e.clientX;
      p.y = e.clientY;
      p.timer = setTimeout(() => {
        p.timer = null;
        p.openedAt = Date.now();
        navigator.vibrate?.(10);
        open(el, { x: p.x, y: p.y }, "sheet");
      }, 500);
    }
    function onPointerMove(e: PointerEvent) {
      if (p.timer && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) {
        clearTimeout(p.timer);
        p.timer = null;
      }
    }
    function onPointerEnd() {
      if (p.timer) clearTimeout(p.timer);
      p.timer = null;
    }
    // The finger lifting after a long press is not a tap on what was under it.
    function onClick(e: MouseEvent) {
      if (Date.now() - p.openedAt < 800 && !(e.target instanceof Element && e.target.closest("[role=menu]"))) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerEnd);
    document.addEventListener("pointercancel", onPointerEnd);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerEnd);
      document.removeEventListener("pointercancel", onPointerEnd);
      document.removeEventListener("click", onClick, true);
      if (p.timer) clearTimeout(p.timer);
    };
  }, []);

  return (
    <>
      {menu && (
        <ContextMenu
          key={menu.key}
          panel={{ id: "app", title: menu.title, entries: menu.entries }}
          at={menu.at}
          mode={menu.mode}
          label={menu.title}
          closeLabel={t.close}
          backLabel={t.back}
          onClose={() => setMenu(null)}
        />
      )}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
        {notice && (
          <p role="status" className="rounded-lg bg-ink px-3.5 py-2 text-sm font-medium text-bg shadow-lg">
            {notice}
          </p>
        )}
      </div>
    </>
  );
}

/** What a control says, for the menu: its own menu label, its accessible name or its text. */
function controlLabel(el: HTMLElement): string {
  const own = el.dataset.menuLabel ?? el.getAttribute("aria-label") ?? el.getAttribute("title");
  if (own) return own.trim();
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  // An icon-only control ("✕") says nothing on its own.
  return /[\p{L}\p{N}]{2,}/u.test(text) ? text.slice(0, 60) : "";
}

function firstLine(el: HTMLElement): string {
  return (el.innerText ?? el.textContent ?? "").split("\n").map((s) => s.trim()).find(Boolean)?.slice(0, 60) ?? "";
}
