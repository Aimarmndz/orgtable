import { describe, it, expect } from "vitest";
import { positionAtEnd, isValidPositionKey } from "@/app/lib/ordering";

// El orden de listas/tarjetas es una clave string lexicográfica (fractional indexing,
// ADR 0002). Lo que importa: añadir al final mantiene el orden y las claves que llegan del
// cliente se validan antes de guardarse.
describe("ordering (fractional indexing)", () => {
  it("positionAtEnd produce claves en orden lexicográfico al añadir al final", () => {
    let last: string | null = null;
    const keys: string[] = [];
    for (let i = 0; i < 6; i++) {
      const k = positionAtEnd(last);
      keys.push(k);
      last = k;
    }
    expect(keys).toEqual([...keys].sort());
    // Sin claves repetidas.
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("isValidPositionKey acepta claves generadas por la librería", () => {
    expect(isValidPositionKey("a0")).toBe(true);
    expect(isValidPositionKey("a0V")).toBe(true);
    expect(isValidPositionKey(positionAtEnd(positionAtEnd(null)))).toBe(true);
  });

  it("isValidPositionKey rechaza claves que romperían positionAtEnd", () => {
    const bad = ["", "x", "a", "a00", "!!!", "a0 ", "zzzz~", "a" + "1".repeat(64)];
    for (const key of bad) {
      expect(isValidPositionKey(key)).toBe(false);
    }
  });
});
