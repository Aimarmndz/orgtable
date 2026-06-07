import { describe, it, expect } from "vitest";
import { positionAtEnd, positionBetween } from "@/app/lib/ordering";

// El orden de listas/tarjetas es una clave string lexicográfica (fractional indexing,
// ADR 0002). Lo que importa: añadir al final mantiene el orden, e insertar entre dos
// claves produce una clave estrictamente intermedia.
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

  it("positionBetween cae estrictamente entre dos claves contiguas", () => {
    const a = positionAtEnd(null);
    const b = positionAtEnd(a);
    const mid = positionBetween(a, b);
    expect(a < mid).toBe(true);
    expect(mid < b).toBe(true);
  });

  it("positionBetween(null, primera) coloca antes de todo", () => {
    const first = positionAtEnd(null);
    const before = positionBetween(null, first);
    expect(before < first).toBe(true);
  });
});
