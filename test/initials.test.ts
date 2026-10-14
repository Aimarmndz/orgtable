import { describe, it, expect } from "vitest";
import { initials } from "@/app/lib/initials";

describe("initials", () => {
  it.each([
    ["Lucía Martín", "LM"],
    ["ana", "A"],
    ["  Óscar   de la Fuente ", "ÓD"],
    ["", "?"],
  ])("%j → %s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
