import { describe, it, expect } from "vitest";
import {
  boardBackground,
  pickBoardColor,
  boardBackgroundFor,
  labelBackground,
  BOARD_COLORS,
  BOARD_COLOR_KEYS,
  LABEL_COLORS,
} from "@/app/lib/colors";

describe("colors", () => {
  it("boardBackground resuelve un color conocido y cae a azul por defecto", () => {
    expect(boardBackground("green")).toBe(BOARD_COLORS.green);
    expect(boardBackground("desconocido")).toBe(BOARD_COLORS.blue);
    expect(boardBackground("constructor")).toBe(BOARD_COLORS.blue);
    expect(boardBackground(null)).toBe(BOARD_COLORS.blue);
  });

  it("pickBoardColor es determinista y siempre dentro de la paleta", () => {
    expect(pickBoardColor("mismo-seed")).toBe(pickBoardColor("mismo-seed"));
    for (const seed of ["a", "board-123", "Lanzamiento web", ""]) {
      expect(BOARD_COLOR_KEYS).toContain(pickBoardColor(seed));
    }
  });

  it("boardBackgroundFor usa el color guardado o uno estable por id", () => {
    expect(boardBackgroundFor({ id: "x", background: "teal" })).toBe(
      BOARD_COLORS.teal,
    );
    // Sin color guardado: estable para el mismo id.
    const r1 = boardBackgroundFor({ id: "stable-id", background: null });
    const r2 = boardBackgroundFor({ id: "stable-id", background: null });
    expect(r1).toBe(r2);
    // Un color inválido guardado también cae al determinista por id.
    expect(boardBackgroundFor({ id: "y", background: "no-existe" })).toBe(
      BOARD_COLORS[pickBoardColor("y")],
    );
  });

  it("labelBackground resuelve y cae a azul por defecto", () => {
    expect(labelBackground("red")).toBe(LABEL_COLORS.red);
    expect(labelBackground("no-existe")).toBe(LABEL_COLORS.blue);
    expect(labelBackground(null)).toBe(LABEL_COLORS.blue);
  });

  // Regresión: con el operador `in`, las claves del prototipo pasaban la comprobación y se
  // pintaba una función como color.
  it("las claves del prototipo no se toman como colores", () => {
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
