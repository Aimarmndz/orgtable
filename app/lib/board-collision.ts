// Collision detection and keyboard navigation for board dragging, in a PURE module (no
// React, no DOM) so it can be tested with synthetic rectangles
// (test/board-collision.test.ts). See docs/drag-and-drop.md.
import {
  closestCorners,
  KeyboardCode,
  type CollisionDetection,
  type KeyboardCodes,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

type Typed = { data: { current?: { type?: unknown } } };

function isListDroppable(c: Typed): boolean {
  return c.data.current?.type === "list";
}

/**
 * `closestCorners`, but when dragging a LIST it only considers other lists. Without the
 * filter, the list's floating rectangle (short, at the top of the column) is closer to
 * the column's first card than to the column itself, `over` turned out to be a card and
 * list reordering was discarded almost every time.
 */
export const boardCollisionDetection: CollisionDetection = (args) => {
  if (args.active.data.current?.type !== "list") return closestCorners(args);
  return closestCorners({
    ...args,
    droppableContainers: args.droppableContainers.filter(isListDroppable),
  });
};

/**
 * `KeyboardSensor` keys. Space picks up and drops; Enter does NOT pick up (it stays free
 * to open the card) but does drop. Escape cancels.
 */
export const DRAG_KEYBOARD_CODES: KeyboardCodes = {
  start: [KeyboardCode.Space],
  cancel: [KeyboardCode.Esc],
  end: [KeyboardCode.Space, KeyboardCode.Enter, KeyboardCode.Tab],
};

type Rect = { left: number; top: number; width: number; right: number };

/** Column closest to `refLeft` in the given direction (`dir` = -1 left, 1 right). */
function neighborColumn(
  columns: { rect: Rect }[],
  refLeft: number,
  dir: -1 | 1,
): { rect: Rect } | null {
  let best: { rect: Rect } | null = null;
  let bestDistance = Infinity;
  for (const column of columns) {
    const dx = column.rect.left - refLeft;
    if (dx * dir <= 0) continue;
    if (Math.abs(dx) < bestDistance) {
      best = column;
      bestDistance = Math.abs(dx);
    }
  }
  return best;
}

/**
 * Keyboard coordinates for the board.
 *
 * - LIST: `sortableKeyboardCoordinates` mixes cards and columns, and the list's own first
 *   card counts as "to the right" (8 px margin), so the first arrow press did nothing;
 *   here the arrow jumps straight to the neighbouring column.
 * - CARD with left/right: for `sortableKeyboardCoordinates` the card's own column counts
 *   as "to the left" (its edge is 8 px before the card's), so the left arrow put the card
 *   back in its column and never moved it. Here it jumps to the neighbouring column and,
 *   within it, to the vertically closest card (or the column itself if empty). Up/down
 *   still use `@dnd-kit/sortable`'s coordinates.
 */
export const boardKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  args,
) => {
  const { active, collisionRect, droppableContainers, droppableRects } =
    args.context;
  const right = event.code === KeyboardCode.Right;
  const left = event.code === KeyboardCode.Left;
  const isList = active?.data.current?.type === "list";
  if (!isList && !right && !left) {
    return sortableKeyboardCoordinates(event, args);
  }
  if (!right && !left) {
    // Lists only move horizontally: up/down do nothing (and do not scroll the page).
    if (event.code === KeyboardCode.Up || event.code === KeyboardCode.Down) {
      event.preventDefault();
    }
    return undefined;
  }
  event.preventDefault();
  if (!collisionRect) return undefined;

  const enabled = droppableContainers.getEnabled();
  const columns = enabled.filter(isListDroppable).flatMap((c) => {
    const rect = droppableRects.get(c.id);
    return rect ? [{ rect }] : [];
  });
  const dir = right ? 1 : -1;

  if (isList) {
    const target = neighborColumn(columns, collisionRect.left, dir);
    return target ? { x: target.rect.left, y: target.rect.top } : undefined;
  }

  // Card: the reference is the edge of ITS column (the one containing its centre), not
  // the card's, so its own column never counts as a neighbour.
  const centerX = collisionRect.left + collisionRect.width / 2;
  const own = columns.find(
    (c) => centerX >= c.rect.left && centerX < c.rect.right,
  );
  const target = neighborColumn(
    columns,
    own ? own.rect.left : collisionRect.left,
    dir,
  );
  if (!target) return undefined;

  let bestCard: Rect | null = null;
  for (const c of enabled) {
    if (isListDroppable(c) || c.id === active?.id) continue;
    const r = droppableRects.get(c.id);
    if (!r) continue;
    const cx = r.left + r.width / 2;
    if (cx < target.rect.left || cx >= target.rect.right) continue;
    if (
      !bestCard ||
      Math.abs(r.top - collisionRect.top) < Math.abs(bestCard.top - collisionRect.top)
    ) {
      bestCard = r;
    }
  }
  const dest = bestCard ?? target.rect;
  return { x: dest.left, y: dest.top };
};

/**
 * Keyboard coordinates for the calendar: each arrow moves the chip to the neighbouring
 * cell (previous/next day, same column one week earlier/later). `@dnd-kit/sortable`'s
 * don't work here because the chip is not a sortable item (they return nothing), and the
 * defaults move 25 px per key press.
 */
export const calendarKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { context },
) => {
  const dir = {
    [KeyboardCode.Right]: { x: 1, y: 0 },
    [KeyboardCode.Left]: { x: -1, y: 0 },
    [KeyboardCode.Down]: { x: 0, y: 1 },
    [KeyboardCode.Up]: { x: 0, y: -1 },
  }[event.code];
  if (!dir) return undefined;
  event.preventDefault(); // the arrows would scroll the page
  const { collisionRect, droppableContainers, droppableRects, over } = context;
  if (!collisionRect) return undefined;

  const cells = droppableContainers
    .getEnabled()
    .map((c) => droppableRects.get(c.id))
    .filter((r) => r !== undefined);
  // Current cell: the one underneath or, failing that, the one containing the chip.
  const current =
    (over ? droppableRects.get(over.id) : undefined) ??
    cells.find(
      (r) =>
        collisionRect.left >= r.left &&
        collisionRect.left < r.right &&
        collisionRect.top >= r.top &&
        collisionRect.top < r.bottom,
    );
  if (!current) return undefined;

  let best: { left: number; top: number; distance: number } | null = null;
  for (const r of cells) {
    const dx = r.left - current.left;
    const dy = r.top - current.top;
    // Same row (for left/right) or same column (for up/down).
    const aligned =
      dir.x !== 0
        ? Math.abs(dy) < current.height / 2
        : Math.abs(dx) < current.width / 2;
    const ahead = dir.x !== 0 ? dx * dir.x > 0 : dy * dir.y > 0;
    if (!aligned || !ahead) continue;
    const distance = Math.abs(dx) + Math.abs(dy);
    if (!best || distance < best.distance) {
      best = { left: r.left, top: r.top, distance };
    }
  }
  if (!best) return undefined;
  // Keep the chip's offset within the cell.
  return {
    x: best.left + (collisionRect.left - current.left),
    y: best.top + (collisionRect.top - current.top),
  };
};
