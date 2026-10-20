"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  menuPosition,
  submenuPosition,
  type Point,
} from "@/app/lib/board-menu";

// A context menu drawn from a description of its entries (what the board menu builds in
// board-menu.tsx). Two shapes from the same entries: a popover at the pointer with
// submenus to the side (mouse, keyboard) and a bottom sheet where a submenu replaces the
// list (touch). Keyboard: arrows, Home/End, → opens a submenu, ← or Escape goes back,
// Enter/Space activates, the letter shown on an item activates it, Tab closes. Focus goes
// back where it was when the menu closes. See docs/board-menu.md.

export type MenuItem = {
  kind: "item";
  id: string;
  label: string;
  /** Shorter label for the big buttons on top of the sheet. */
  shortLabel?: string;
  icon?: ReactNode;
  /** Text on the right: a count, the current value… */
  hint?: string;
  /** Key that activates the item while the menu is open ("r", "Enter", "Delete"…). */
  accel?: string;
  /** How the key is shown ("R", "↵", "Supr"). */
  accelLabel?: string;
  danger?: boolean;
  /** Set for checkbox/radio items: whether it is on. */
  checked?: boolean;
  role?: "menuitem" | "menuitemcheckbox" | "menuitemradio";
  /** Stays open after it runs (toggles in a submenu). */
  keepOpen?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  submenu?: MenuPanel;
};
export type MenuEntry =
  | MenuItem
  | { kind: "separator"; id: string }
  | { kind: "custom"; id: string; render: (api: MenuApi) => ReactNode };
export type MenuPanel = {
  id: string;
  title: string;
  entries: MenuEntry[];
  width?: number;
};
export type MenuApi = { close: () => void; back: () => void };

const ITEM = "[data-menu-item]:not([disabled])";

export function ContextMenu({
  panel,
  at,
  mode,
  quick,
  subtitle,
  label,
  closeLabel,
  backLabel,
  onClose,
}: {
  panel: MenuPanel;
  at: Point;
  mode: "popover" | "sheet";
  /** Big buttons on top of the sheet (touch only). */
  quick?: MenuItem[];
  subtitle?: string;
  label: string;
  closeLabel: string;
  backLabel: string;
  onClose: () => void;
}) {
  const [subId, setSubId] = useState<string | null>(null);
  const [subFocus, setSubFocus] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const [mainPos, setMainPos] = useState<Point | null>(null);
  const [subPos, setSubPos] = useState<Point | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armed = useRef(false);
  // Where the focus was before the menu: it goes back there on close.
  const [returnTo] = useState<Element | null>(() =>
    typeof document === "undefined" ? null : document.activeElement,
  );

  const items = panel.entries.filter((e): e is MenuItem => e.kind === "item");
  const sub =
    [...items, ...(quick ?? [])].find((e) => e.id === subId && e.submenu)
      ?.submenu ?? null;

  const close = useCallback(() => onClose(), [onClose]);
  const back = useCallback(() => {
    const parent = subId;
    setSubId(null);
    setSubPos(null);
    requestAnimationFrame(() => {
      mainRef.current
        ?.querySelector<HTMLElement>(`[data-entry="${parent}"]`)
        ?.focus();
    });
  }, [subId]);
  const api: MenuApi = { close, back };

  // Popover: measured before paint, then placed inside the window.
  useLayoutEffect(() => {
    if (mode !== "popover" || !mainRef.current) return;
    const r = mainRef.current.getBoundingClientRect();
    setMainPos(
      menuPosition(
        at,
        { width: r.width, height: r.height },
        { width: innerWidth, height: innerHeight },
      ),
    );
  }, [at, mode]);
  useLayoutEffect(() => {
    if (mode !== "popover" || !sub || !subRef.current || !mainRef.current)
      return;
    const item = mainRef.current.querySelector(`[data-entry="${subId}"]`);
    if (!item) return;
    const r = subRef.current.getBoundingClientRect();
    setSubPos(
      submenuPosition(
        item.getBoundingClientRect(),
        mainRef.current.getBoundingClientRect(),
        { width: r.width, height: r.height },
        { width: innerWidth, height: innerHeight },
      ),
    );
  }, [mode, sub, subId, mainPos]);

  // First item focused on open, and on entering a submenu from the keyboard. A popover
  // only once it is placed: until then it is hidden, and a hidden element takes no focus.
  const placed = mode === "sheet" || mainPos !== null;
  const subPlaced = mode === "sheet" || subPos !== null;
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!placed || focusedOnce.current) return;
    focusedOnce.current = true;
    mainRef.current
      ?.querySelector<HTMLElement>(ITEM)
      ?.focus({ preventScroll: true });
  }, [placed]);
  useEffect(() => {
    if (!sub || !subPlaced) return;
    if (mode === "sheet" || subFocus) {
      const root = mode === "sheet" ? mainRef.current : subRef.current;
      root
        ?.querySelector<HTMLElement>(`${ITEM}, input`)
        ?.focus({ preventScroll: true });
    }
  }, [sub, subFocus, subPlaced, mode]);

  useEffect(() => {
    const inside = (t: EventTarget | null) =>
      t instanceof Node &&
      (mainRef.current?.contains(t) || subRef.current?.contains(t));
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) close();
    };
    const onScroll = (e: Event) => {
      if (!inside(e.target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !inside(e.target)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      // Back to where the person was, unless they already moved the focus elsewhere.
      const active = document.activeElement;
      if (
        returnTo instanceof HTMLElement &&
        returnTo.isConnected &&
        (!active || active === document.body || inside(active))
      ) {
        returnTo.focus({ preventScroll: true });
      }
    };
  }, [close, returnTo]);

  function activate(item: MenuItem, fromKeyboard: boolean) {
    if (item.disabled) return;
    if (item.submenu) {
      setSubFocus(fromKeyboard);
      setSubId(item.id);
      return;
    }
    item.onSelect?.();
    if (!item.keepOpen) close();
  }

  function onKeyDown(
    e: ReactKeyboardEvent<HTMLDivElement>,
    level: "main" | "sub",
  ) {
    const typing =
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (level === "sub" || (mode === "sheet" && sub)) back();
      else close();
      return;
    }
    if (typing) return;
    if (e.key === "Tab") {
      e.preventDefault();
      close();
      return;
    }
    const root = e.currentTarget;
    const list = [...root.querySelectorAll<HTMLElement>(ITEM)];
    const at = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number) =>
      list[(i + list.length) % list.length]?.focus();
    const current = currentEntries(level);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        return focusAt(at + 1);
      case "ArrowUp":
        e.preventDefault();
        return focusAt(at < 0 ? -1 : at - 1);
      case "Home":
        e.preventDefault();
        return focusAt(0);
      case "End":
        e.preventDefault();
        return focusAt(-1);
      case "ArrowRight": {
        const id = (document.activeElement as HTMLElement | null)?.dataset
          .entry;
        const item = current.find((x) => x.id === id);
        if (item?.submenu) {
          e.preventDefault();
          activate(item, true);
        }
        return;
      }
      case "ArrowLeft":
        if (level === "sub" || (mode === "sheet" && sub)) {
          e.preventDefault();
          back();
        }
        return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const hit = current.find(
      (x) =>
        x.accel &&
        !x.disabled &&
        (x.accel.length === 1
          ? x.accel.toLowerCase() === e.key.toLowerCase()
          : x.accel === e.key),
    );
    // Enter and Space on a focused item are the button's own click.
    if (hit && !(hit.accel === "Enter" && list[at])) {
      e.preventDefault();
      activate(hit, true);
    }
  }

  function currentEntries(level: "main" | "sub"): MenuItem[] {
    const entries =
      level === "sub" || (mode === "sheet" && sub)
        ? (sub?.entries ?? [])
        : panel.entries;
    return [
      ...entries.filter((x): x is MenuItem => x.kind === "item"),
      ...(level === "main" && !sub ? (quick ?? []) : []),
    ];
  }

  function hover(item: MenuItem | null) {
    if (mode !== "popover") return;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (item?.submenu && !item.disabled) {
      if (subId === item.id) return;
      hoverTimer.current = setTimeout(() => {
        setSubFocus(false);
        setSubId(item.id);
      }, 120);
    } else if (subId) {
      // A short grace so a diagonal move toward the submenu does not close it.
      hoverTimer.current = setTimeout(() => {
        setSubId(null);
        setSubPos(null);
      }, 280);
    }
  }

  const renderEntries = (entries: MenuEntry[], level: "main" | "sub") =>
    tidy(entries).map((entry) => {
      if (entry.kind === "separator")
        return (
          <div
            key={entry.id}
            role="separator"
            className="mx-1 my-1.5 h-px bg-border"
          />
        );
      if (entry.kind === "custom")
        return <CustomEntry key={entry.id} render={entry.render} api={api} />;
      const open = entry.submenu && subId === entry.id;
      return (
        <button
          key={entry.id}
          type="button"
          data-menu-item=""
          data-entry={entry.id}
          role={entry.role ?? "menuitem"}
          aria-checked={
            entry.role && entry.role !== "menuitem"
              ? Boolean(entry.checked)
              : undefined
          }
          aria-haspopup={entry.submenu ? "menu" : undefined}
          aria-expanded={entry.submenu ? Boolean(open) : undefined}
          disabled={entry.disabled}
          onClick={(e) => activate(entry, e.detail === 0)}
          onPointerEnter={() =>
            level === "main"
              ? hover(entry)
              : hoverTimer.current && clearTimeout(hoverTimer.current)
          }
          className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left font-medium outline-none transition-colors disabled:opacity-50 ${
            mode === "sheet" ? "min-h-12 text-[15px]" : "h-9 text-sm"
          } ${entry.danger ? "text-danger" : "text-ink"} ${
            open
              ? "bg-accent/10 text-accent"
              : "hover:bg-surface-2 focus-visible:bg-surface-2"
          }`}
        >
          {entry.icon && (
            <span
              className={`grid size-4 shrink-0 place-items-center ${entry.danger ? "" : open ? "text-accent" : "text-ink-muted"}`}
            >
              {entry.icon}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate">{entry.label}</span>
          {entry.hint && (
            <span className="shrink-0 text-xs text-ink-muted">
              {entry.hint}
            </span>
          )}
          {entry.checked && entry.role !== "menuitem" && (
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
          {entry.accelLabel && mode === "popover" && (
            <kbd
              className={`shrink-0 font-mono text-[11.5px] ${entry.danger ? "text-danger" : "text-ink-muted"}`}
            >
              {entry.accelLabel}
            </kbd>
          )}
          {entry.submenu && (
            <svg
              className="size-4 shrink-0 text-ink-muted"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
          )}
        </button>
      );
    });

  if (typeof document === "undefined") return null;
  // An open modal <dialog> (the card) sits in the top layer and makes the rest of the page
  // inert: a menu in <body> would be drawn under it and could not be clicked.
  const host = document.querySelector<HTMLDialogElement>("dialog[open]:modal") ?? document.body;

  if (mode === "sheet") {
    const showing = sub ?? panel;
    return createPortal(
      <div
        className="fixed inset-0 z-50"
        // The finger that held the card for the long press lifts over the sheet: that
        // click is not a choice. Only a touch that starts on the sheet counts.
        onPointerDownCapture={() => (armed.current = true)}
        onClickCapture={(e) => {
          if (!armed.current && e.detail !== 0) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <button
          type="button"
          aria-label={closeLabel}
          onClick={close}
          className="absolute inset-0 bg-[oklch(0.2_0.02_52/0.45)]"
        />
        <div
          ref={mainRef}
          role="menu"
          aria-label={showing.title}
          onKeyDown={(e) => onKeyDown(e, "main")}
          className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-bg px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2 text-ink shadow-[0_-12px_40px_-12px_oklch(0.27_0.022_52/0.35)]"
        >
          <div
            aria-hidden="true"
            className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-border"
          />
          <div className="flex items-center gap-2 px-1 pb-3">
            {sub && (
              <button
                type="button"
                onClick={back}
                aria-label={backLabel}
                className="grid size-11 shrink-0 place-items-center rounded-lg text-ink hover:bg-surface-2"
              >
                <svg
                  className="size-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M15 6l-6 6 6 6" />
                </svg>
              </button>
            )}
            <div className="min-w-0">
              <p className="truncate font-display text-lg font-extrabold">
                {showing.title}
              </p>
              {!sub && subtitle && (
                <p className="truncate text-[13px] text-ink-muted">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          {!sub && quick && quick.length > 0 && (
            <div className="mb-3.5 grid grid-cols-4 gap-2">
              {quick.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  data-menu-item=""
                  data-entry={q.id}
                  onClick={(e) => activate(q, e.detail === 0)}
                  className="flex h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-surface text-[12.5px] font-semibold text-ink"
                >
                  <span className="grid size-5 place-items-center text-accent">
                    {q.icon}
                  </span>
                  {q.shortLabel ?? q.label}
                </button>
              ))}
            </div>
          )}
          <div className="rounded-2xl border border-border bg-surface p-1.5">
            {renderEntries(showing.entries, sub ? "sub" : "main")}
          </div>
        </div>
      </div>,
      host,
    );
  }

  return createPortal(
    <>
      <div
        ref={mainRef}
        role="menu"
        aria-label={label}
        onKeyDown={(e) => onKeyDown(e, "main")}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          left: mainPos?.x ?? at.x,
          top: mainPos?.y ?? at.y,
          width: panel.width ?? 264,
          visibility: mainPos ? "visible" : "hidden",
        }}
        className="fixed z-50 max-h-[calc(100vh-16px)] overflow-y-auto rounded-xl border border-border bg-surface p-1.5 text-ink shadow-[0_16px_40px_-12px_oklch(0.27_0.022_52/0.35),0_2px_6px_oklch(0.27_0.022_52/0.08)]"
      >
        <p className="truncate px-2.5 pb-1.5 pt-2 text-[10.5px] font-bold uppercase tracking-[0.09em] text-ink-muted">
          {panel.title}
        </p>
        {renderEntries(panel.entries, "main")}
      </div>
      {sub && (
        <div
          ref={subRef}
          role="menu"
          aria-label={sub.title}
          onKeyDown={(e) => onKeyDown(e, "sub")}
          onContextMenu={(e) => e.preventDefault()}
          onPointerEnter={() =>
            hoverTimer.current && clearTimeout(hoverTimer.current)
          }
          style={{
            left: subPos?.x ?? 0,
            top: subPos?.y ?? 0,
            width: sub.width ?? 248,
            visibility: subPos ? "visible" : "hidden",
          }}
          className="fixed z-50 max-h-[calc(100vh-16px)] overflow-y-auto rounded-xl border border-border bg-surface p-1.5 text-ink shadow-[0_16px_40px_-12px_oklch(0.27_0.022_52/0.35),0_2px_6px_oklch(0.27_0.022_52/0.08)]"
        >
          <p className="truncate px-2.5 pb-1.5 pt-2 text-[10.5px] font-bold uppercase tracking-[0.09em] text-ink-muted">
            {sub.title}
          </p>
          {renderEntries(sub.entries, "sub")}
        </div>
      )}
    </>,
    host,
  );
}

/** Without separators at either end or two in a row (left by entries a role hides). */
function tidy(entries: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "separator" && (out.length === 0 || out[out.length - 1].kind === "separator")) continue;
    out.push(entry);
  }
  while (out.length && out[out.length - 1].kind === "separator") out.pop();
  return out;
}

// A free-form entry (a form, a colour grid). Its own component, so what it draws is not
// computed while the menu renders its refs.
function CustomEntry({ render, api }: { render: (api: MenuApi) => ReactNode; api: MenuApi }) {
  return <div>{render(api)}</div>;
}
