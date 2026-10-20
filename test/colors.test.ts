import { describe, it, expect } from "vitest";
import {
  pickBoardColor,
  boardBackgroundFor,
  labelBackground,
  labelText,
  boardBackgroundCss,
  boardNeedsScrim,
  BOARD_COLORS,
  BOARD_COLOR_KEYS,
  LABEL_COLORS,
} from "@/app/lib/colors";

describe("colors", () => {
  it("pickBoardColor is deterministic and always within the palette", () => {
    expect(pickBoardColor("same-seed")).toBe(pickBoardColor("same-seed"));
    for (const seed of ["a", "board-123", "Website launch", ""]) {
      expect(BOARD_COLOR_KEYS).toContain(pickBoardColor(seed));
    }
  });

  it("boardBackgroundFor uses the stored colour or a stable one per id", () => {
    expect(boardBackgroundFor({ id: "x", background: "teal" })).toBe(
      BOARD_COLORS.teal,
    );
    // Without a stored colour: stable for the same id.
    const r1 = boardBackgroundFor({ id: "stable-id", background: null });
    const r2 = boardBackgroundFor({ id: "stable-id", background: null });
    expect(r1).toBe(r2);
    // An invalid stored colour also falls back to the deterministic one per id.
    expect(boardBackgroundFor({ id: "y", background: "missing" })).toBe(
      BOARD_COLORS[pickBoardColor("y")],
    );
  });

  it("labelBackground takes a free #rrggbb colour and nothing looser", () => {
    expect(labelBackground("#F54927")).toBe("#f54927");
    for (const bad of ["#f54", "f54927", "#f54927;background:url(x)", "red; x", "#gggggg"]) {
      expect(labelBackground(bad)).toBe(LABEL_COLORS.blue);
    }
  });

  it("boards take a free #rrggbb colour and an image on top of it", () => {
    expect(boardBackgroundFor({ id: "x", background: "#3B6E8F" })).toBe("#3b6e8f");
    expect(boardBackgroundFor({ id: "x", background: "#3b6e8f;x" })).toBe(BOARD_COLORS[pickBoardColor("x")]);
    expect(boardBackgroundCss({ id: "b1", background: "teal", backgroundImageStoredName: "background-a.webp" })).toBe(
      `center / cover no-repeat url("/api/boards/b1/background?v=background-a.webp"), ${BOARD_COLORS.teal}`,
    );
    expect(boardBackgroundCss({ id: "b1", background: "teal" })).toBe(BOARD_COLORS.teal);
  });

  it("boardNeedsScrim veils images and light free colours, not the palette", () => {
    expect(boardNeedsScrim({ background: "teal" })).toBe(false);
    expect(boardNeedsScrim({ background: "#1d3557" })).toBe(false);
    expect(boardNeedsScrim({ background: "#ffe066" })).toBe(true);
    expect(boardNeedsScrim({ background: null, backgroundImageStoredName: "background-a.webp" })).toBe(true);
  });

  it("labelText picks the text that contrasts more", () => {
    expect(labelText("red")).toBe("#ffffff");
    expect(labelText("#1d3557")).toBe("#ffffff");
    expect(labelText("#ffe066")).not.toBe("#ffffff");
    expect(labelText("#ffffff")).not.toBe("#ffffff");
  });

  it("labelBackground resolves and falls back to blue by default", () => {
    expect(labelBackground("red")).toBe(LABEL_COLORS.red);
    expect(labelBackground("missing")).toBe(LABEL_COLORS.blue);
    expect(labelBackground(null)).toBe(LABEL_COLORS.blue);
  });

  // Regression: with the `in` operator, prototype keys passed the check and a function was
  // painted as a colour.
  it("prototype keys are not taken as colours", () => {
    for (const key of ["constructor", "__proto__", "toString"]) {
      expect(labelBackground(key)).toBe(LABEL_COLORS.blue);
      expect(boardBackgroundFor({ id: "y", background: key })).toBe(
        BOARD_COLORS[pickBoardColor("y")],
      );
    }
    expect(boardBackgroundFor({ id: "y", background: "toString" })).toMatch(
      /^oklch\(/,
    );
  });
});
