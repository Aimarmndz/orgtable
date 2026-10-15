import { describe, it, expect } from "vitest";
import { dueShortcuts, edgeKey, localDay, menuPosition, neighbourKey, submenuPosition } from "@/app/lib/board-menu";
import { BOARD_COLOR_KEYS, pickBoardColor } from "@/app/lib/colors";

const viewport = { width: 1000, height: 700 };
const menu = { width: 260, height: 300 };

describe("menuPosition", () => {
  it("opens below and to the right of the pointer when it fits", () => {
    expect(menuPosition({ x: 100, y: 120 }, menu, viewport)).toEqual({ x: 100, y: 120 });
  });

  it("flips to the left and up near the right and bottom edges", () => {
    expect(menuPosition({ x: 900, y: 650 }, menu, viewport)).toEqual({ x: 640, y: 350 });
  });

  it("never leaves the window, even when the menu is taller than it", () => {
    const pos = menuPosition({ x: 5, y: 5 }, { width: 260, height: 900 }, viewport);
    expect(pos).toEqual({ x: 8, y: 8 });
  });
});

describe("submenuPosition", () => {
  const parent = { left: 100, top: 100, right: 360, bottom: 500 };
  const item = { left: 106, top: 200, right: 354, bottom: 236 };

  it("goes to the right of the parent, aligned with the item", () => {
    expect(submenuPosition(item, parent, { width: 240, height: 200 }, viewport)).toEqual({ x: 364, y: 194 });
  });

  it("goes to the left when the right side has no room", () => {
    const right = { left: 700, top: 100, right: 960, bottom: 500 };
    expect(submenuPosition({ ...item, left: 706, right: 954 }, right, { width: 240, height: 200 }, viewport).x).toBe(456);
  });
});

describe("dueShortcuts", () => {
  it("counts local days from today", () => {
    // Wednesday 15 October 2026, late in the evening (local time).
    expect(dueShortcuts(new Date(2026, 9, 15, 23, 30))).toEqual({
      today: "2026-10-15",
      tomorrow: "2026-10-16",
      nextMonday: "2026-10-19",
      inAWeek: "2026-10-22",
    });
  });

  it("next Monday is never today, and crosses month ends", () => {
    expect(dueShortcuts(new Date(2026, 10, 30)).nextMonday).toBe("2026-12-07");
    expect(dueShortcuts(new Date(2026, 9, 31)).tomorrow).toBe("2026-11-01");
  });

  it("formats a local day with padding", () => {
    expect(localDay(new Date(2027, 0, 5))).toBe("2027-01-05");
  });
});

describe("move keys", () => {
  const keys = ["a0", "a1", "a2", "a3"];

  it("neighbourKey lands between the right neighbours", () => {
    const left = neighbourKey(keys, 2, -1)!;
    expect(left > "a0" && left < "a1").toBe(true);
    const right = neighbourKey(keys, 1, 1)!;
    expect(right > "a2" && right < "a3").toBe(true);
    expect(neighbourKey(keys, 1, -1)! < "a0").toBe(true);
    expect(neighbourKey(keys, 2, 1)! > "a3").toBe(true);
  });

  it("neighbourKey is null at the ends", () => {
    expect(neighbourKey(keys, 0, -1)).toBeNull();
    expect(neighbourKey(keys, 3, 1)).toBeNull();
  });

  it("edgeKey goes before the first or after the last, also in an empty list", () => {
    expect(edgeKey(keys, "top") < "a0").toBe(true);
    expect(edgeKey(keys, "bottom") > "a3").toBe(true);
    expect(edgeKey([], "bottom")).toBe("a0");
  });
});

describe("board colours added for the menu", () => {
  it("can be chosen but never come out of the automatic colour", () => {
    expect(BOARD_COLOR_KEYS).toEqual(expect.arrayContaining(["slate", "ink"]));
    for (let i = 0; i < 500; i++) {
      expect(["slate", "ink"]).not.toContain(pickBoardColor(`seed-${i}`));
    }
  });
});
