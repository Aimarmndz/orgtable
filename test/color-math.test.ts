import { describe, it, expect } from "vitest";
import { hexToHsv, hsvToHex, normalizeHex, oklchToHex } from "@/app/lib/color-math";

describe("color-math", () => {
  it("converts the primaries and greys both ways", () => {
    expect(hsvToHex({ h: 0, s: 1, v: 1 })).toBe("#ff0000");
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe("#00ff00");
    expect(hsvToHex({ h: 240, s: 1, v: 1 })).toBe("#0000ff");
    expect(hsvToHex({ h: 200, s: 0, v: 0.5 })).toBe("#808080");
    expect(hexToHsv("#0000ff")).toEqual({ h: 240, s: 1, v: 1 });
    expect(hexToHsv("#000000")).toEqual({ h: 0, s: 0, v: 0 });
  });

  it("round-trips any colour", () => {
    for (const hex of ["#f54927", "#1d3557", "#ffe066", "#2b2118", "#7f7f7f"]) {
      const hsv = hexToHsv(hex);
      expect(hsv).not.toBeNull();
      expect(hsvToHex(hsv!)).toBe(hex);
    }
  });

  it("normalizes what people type and refuses the rest", () => {
    expect(normalizeHex("F54927")).toBe("#f54927");
    expect(normalizeHex(" #f54 ")).toBe("#ff5544");
    expect(normalizeHex("#f5492")).toBeNull();
    expect(normalizeHex("red")).toBeNull();
    expect(hexToHsv("red")).toBeNull();
  });

  it("turns the palette's oklch into hex", () => {
    expect(oklchToHex("oklch(1 0 0)")).toBe("#ffffff");
    expect(oklchToHex("oklch(0 0 0)")).toBe("#000000");
    // Red of the label palette: a red with no blue to speak of.
    const red = oklchToHex("oklch(0.53 0.15 30)")!;
    expect(parseInt(red.slice(1, 3), 16)).toBeGreaterThan(parseInt(red.slice(5, 7), 16) * 2);
    expect(oklchToHex("rgb(0 0 0)")).toBeNull();
  });
});
