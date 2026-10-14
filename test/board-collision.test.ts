import { describe, it, expect, vi } from "vitest";
import {
  closestCorners,
  type Active,
  type ClientRect,
  type DroppableContainer,
  type SensorContext,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  boardCollisionDetection,
  boardKeyboardCoordinates,
  calendarKeyboardCoordinates,
} from "@/app/lib/board-collision";

// Synthetic rectangles with the board's real geometry: w-72 columns (288 px) separated
// by gap-3 (12 px), cards with an 8 px side margin under the header, and the floating
// copy of a list (DragOverlay) of 288×48.
function rect(left: number, top: number, width: number, height: number): ClientRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function droppable(id: string, type: "list" | "card" | "day"): DroppableContainer {
  return {
    id,
    key: id,
    data: { current: { type } },
    disabled: false,
    node: { current: null },
    rect: { current: null },
  } as unknown as DroppableContainer;
}

function active(id: string, type: "list" | "card"): Active {
  return {
    id,
    data: { current: { type } },
    rect: { current: { initial: null, translated: null } },
  };
}

// Column A at x=0, B at x=300, C at x=600; one card in each, at y=49.
const rects = new Map<UniqueIdentifier, ClientRect>([
  ["A", rect(0, 0, 288, 190)],
  ["a1", rect(8, 49, 272, 60)],
  ["B", rect(300, 0, 288, 190)],
  ["b1", rect(308, 49, 272, 60)],
  ["C", rect(600, 0, 288, 190)],
  ["c1", rect(608, 49, 272, 60)],
]);
const containers = [
  droppable("A", "list"),
  droppable("a1", "card"),
  droppable("B", "list"),
  droppable("b1", "card"),
  droppable("C", "list"),
  droppable("c1", "card"),
];

describe("boardCollisionDetection", () => {
  // The copy of list A, dropped over column B.
  const overlayOnB = rect(300, 0, 288, 48);

  it("plain closestCorners resolves the dragged list to a CARD (the bug)", () => {
    const [first] = closestCorners({
      active: active("A", "list"),
      collisionRect: overlayOnB,
      droppableRects: rects,
      droppableContainers: containers,
      pointerCoordinates: null,
    });
    expect(first.id).toBe("b1");
  });

  it("with an active list it resolves to the column", () => {
    const [first] = boardCollisionDetection({
      active: active("A", "list"),
      collisionRect: overlayOnB,
      droppableRects: rects,
      droppableContainers: containers,
      pointerCoordinates: null,
    });
    expect(first.id).toBe("B");
  });

  it("with an active card it still resolves to the card", () => {
    const [first] = boardCollisionDetection({
      active: active("a1", "card"),
      collisionRect: rect(308, 49, 272, 60),
      droppableRects: rects,
      droppableContainers: containers,
      pointerCoordinates: null,
    });
    expect(first.id).toBe("b1");
  });
});

function key(code: string) {
  const preventDefault = vi.fn();
  return { event: { code, preventDefault } as unknown as KeyboardEvent, preventDefault };
}

function context(over: Partial<SensorContext>): SensorContext {
  return {
    droppableRects: rects,
    droppableContainers: { getEnabled: () => containers },
    over: null,
    ...over,
  } as unknown as SensorContext;
}

describe("boardKeyboardCoordinates (lists)", () => {
  const args = (collisionRect: ClientRect) => ({
    active: "A",
    currentCoordinates: { x: collisionRect.left, y: collisionRect.top },
    context: context({ active: active("A", "list"), collisionRect }),
  });

  it("the right arrow jumps to the neighbouring column, not to its own first card", () => {
    const { event, preventDefault } = key("ArrowRight");
    expect(boardKeyboardCoordinates(event, args(rect(0, 0, 288, 48)))).toEqual({
      x: 300,
      y: 0,
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(
      boardKeyboardCoordinates(key("ArrowRight").event, args(rect(300, 0, 288, 48))),
    ).toEqual({ x: 600, y: 0 });
  });

  it("the left arrow goes back to the previous column and stops at the first one", () => {
    expect(
      boardKeyboardCoordinates(key("ArrowLeft").event, args(rect(300, 0, 288, 48))),
    ).toEqual({ x: 0, y: 0 });
    expect(
      boardKeyboardCoordinates(key("ArrowLeft").event, args(rect(0, 0, 288, 48))),
    ).toBeUndefined();
  });

  it("up/down do not move a list", () => {
    const { event, preventDefault } = key("ArrowDown");
    expect(boardKeyboardCoordinates(event, args(rect(0, 0, 288, 48)))).toBeUndefined();
    expect(preventDefault).toHaveBeenCalled();
  });
});

describe("boardKeyboardCoordinates (cards, left/right)", () => {
  // Regression: with the left arrow, the card's own column (its edge is 8 px before)
  // counted as "to the left" and the card went back to its place without moving.
  const args = (id: string, collisionRect: ClientRect, extra?: [string, ClientRect][]) => {
    const r = new Map(rects);
    const cs = [...containers];
    for (const [cid, cr] of extra ?? []) {
      r.set(cid, cr);
      cs.push(droppable(cid, "list"));
    }
    return {
      active: id,
      currentCoordinates: { x: collisionRect.left, y: collisionRect.top },
      context: {
        ...context({ active: active(id, "card"), collisionRect }),
        droppableRects: r,
        droppableContainers: { getEnabled: () => cs },
      } as unknown as SensorContext,
    };
  };

  it("left takes the card to the card of the previous column", () => {
    const { event, preventDefault } = key("ArrowLeft");
    expect(boardKeyboardCoordinates(event, args("b1", rect(308, 49, 272, 60)))).toEqual({
      x: 8,
      y: 49,
    });
    expect(preventDefault).toHaveBeenCalled();
  });

  it("right takes the card to the next column", () => {
    expect(
      boardKeyboardCoordinates(key("ArrowRight").event, args("b1", rect(308, 49, 272, 60))),
    ).toEqual({ x: 608, y: 49 });
  });

  it("in an empty column it points at the column itself", () => {
    expect(
      boardKeyboardCoordinates(
        key("ArrowRight").event,
        args("c1", rect(608, 49, 272, 60), [["D", rect(900, 0, 288, 90)]]),
      ),
    ).toEqual({ x: 900, y: 0 });
  });

  it("does not go past the first or the last column", () => {
    expect(
      boardKeyboardCoordinates(key("ArrowLeft").event, args("a1", rect(8, 49, 272, 60))),
    ).toBeUndefined();
    expect(
      boardKeyboardCoordinates(key("ArrowRight").event, args("c1", rect(608, 49, 272, 60))),
    ).toBeUndefined();
  });
});

describe("calendarKeyboardCoordinates", () => {
  // Grid of 3×2 cells of 100×80 with gap-1 (4 px). The pill is in cell (0,0), shifted
  // 6 px to the right and 20 px down.
  const cells = new Map<UniqueIdentifier, ClientRect>();
  const days: DroppableContainer[] = [];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const id = `d${row}${col}`;
      cells.set(id, rect(col * 104, row * 84, 100, 80));
      days.push(droppable(id, "day"));
    }
  }
  const chip = rect(6, 20, 90, 24);
  const ctx = (overId: string | null) =>
    ({
      collisionRect: chip,
      droppableRects: cells,
      droppableContainers: { getEnabled: () => days },
      over: overId ? { id: overId } : null,
    }) as unknown as SensorContext;
  const run = (code: string, overId: string | null = "d00") =>
    calendarKeyboardCoordinates(key(code).event, {
      active: "card",
      currentCoordinates: { x: chip.left, y: chip.top },
      context: ctx(overId),
    });

  it("right goes to the next day and down to the next week", () => {
    expect(run("ArrowRight")).toEqual({ x: 110, y: 20 });
    expect(run("ArrowDown")).toEqual({ x: 6, y: 104 });
  });

  it("without a neighbouring cell in that direction it does not move", () => {
    expect(run("ArrowLeft")).toBeUndefined();
    expect(run("ArrowUp")).toBeUndefined();
  });

  it("without `over` it uses the cell that contains the pill", () => {
    expect(run("ArrowRight", null)).toEqual({ x: 110, y: 20 });
  });

  it("ignores keys that are not arrows", () => {
    const { event, preventDefault } = key("KeyA");
    expect(
      calendarKeyboardCoordinates(event, {
        active: "card",
        currentCoordinates: { x: 0, y: 0 },
        context: ctx("d00"),
      }),
    ).toBeUndefined();
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
