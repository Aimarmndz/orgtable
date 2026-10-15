import { generateKeyBetween } from "fractional-indexing";

// Pure helpers of the board's context menu (app/components/board/board-menu.tsx): where
// the menu and its submenus go on screen, the due-date shortcuts and the position keys of
// the "move" actions. Kept apart from the component so they can be tested without a DOM.
// See docs/board-menu.md.

export type Size = { width: number; height: number };
export type Point = { x: number; y: number };
export type Rect = { left: number; top: number; right: number; bottom: number };

/** Gap kept between the menu and the window's edges, in px. */
export const MENU_MARGIN = 8;

/**
 * Top-left corner of a menu opened at `at` (the pointer): below and to the right of it,
 * flipped to the other side when it does not fit, and always inside the window.
 */
export function menuPosition(
  at: Point,
  menu: Size,
  viewport: Size,
  margin = MENU_MARGIN,
): Point {
  let x = at.x;
  let y = at.y;
  if (x + menu.width > viewport.width - margin) x = at.x - menu.width;
  if (y + menu.height > viewport.height - margin) y = at.y - menu.height;
  return {
    x: clamp(x, margin, viewport.width - menu.width - margin),
    y: clamp(y, margin, viewport.height - menu.height - margin),
  };
}

/**
 * Top-left corner of a submenu opened from the item `item`: to the right of the parent
 * menu, or to its left when the right side has no room; top aligned with the item.
 */
export function submenuPosition(
  item: Rect,
  parent: Rect,
  menu: Size,
  viewport: Size,
  margin = MENU_MARGIN,
): Point {
  const gap = 4;
  let x = parent.right + gap;
  if (x + menu.width > viewport.width - margin)
    x = parent.left - menu.width - gap;
  return {
    x: clamp(x, margin, viewport.width - menu.width - margin),
    y: clamp(item.top - 6, margin, viewport.height - menu.height - margin),
  };
}

function clamp(n: number, min: number, max: number): number {
  // A menu taller or wider than the window sticks to the top-left margin.
  return Math.max(min, Math.min(n, max));
}

/** "YYYY-MM-DD" of a date in the browser's local calendar (what setCardDueDate takes). */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The due-date shortcuts of the card menu, as local days counted from `now`. */
export function dueShortcuts(now: Date): {
  today: string;
  tomorrow: string;
  nextMonday: string;
  inAWeek: string;
} {
  const day = (offset: number) =>
    localDay(
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset),
    );
  // Next Monday is never today: on a Monday it is the one a week later.
  const toMonday = (8 - now.getDay()) % 7 || 7;
  return {
    today: day(0),
    tomorrow: day(1),
    nextMonday: day(toMonday),
    inAWeek: day(7),
  };
}

/**
 * The key that moves the item at `index` one place left (-1) or right (+1) among
 * `positions` (sorted), or null when it is already at that end.
 */
export function neighbourKey(
  positions: string[],
  index: number,
  direction: -1 | 1,
): string | null {
  if (direction === -1) {
    if (index <= 0) return null;
    return generateKeyBetween(
      positions[index - 2] ?? null,
      positions[index - 1],
    );
  }
  if (index >= positions.length - 1) return null;
  return generateKeyBetween(positions[index + 1], positions[index + 2] ?? null);
}

/** The key that puts an item first (`"top"`) or last (`"bottom"`) among `positions` (sorted). */
export function edgeKey(positions: string[], edge: "top" | "bottom"): string {
  return edge === "top"
    ? generateKeyBetween(null, positions[0] ?? null)
    : generateKeyBetween(positions[positions.length - 1] ?? null, null);
}
