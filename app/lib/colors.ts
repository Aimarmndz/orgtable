// Paletas de color del CONTENIDO (no del cromo): fondos de tablero y etiquetas.
// Estética editorial cálida: tonos apagados y sofisticados (clay, oliva, ciruela,
// ocre, ladrillo, pizarra) que conviven con el acento terracota. Luminosidad baja
// (L≤0.54) para que el texto blanco encima sea legible. Ver DESIGN.md.

export const BOARD_COLORS = {
  blue: "oklch(0.5 0.07 248)",
  green: "oklch(0.5 0.07 150)",
  purple: "oklch(0.48 0.09 330)",
  amber: "oklch(0.54 0.09 62)",
  rose: "oklch(0.52 0.12 33)",
  teal: "oklch(0.5 0.06 200)",
} as const;

export type BoardColor = keyof typeof BOARD_COLORS;
export const BOARD_COLOR_KEYS = Object.keys(BOARD_COLORS) as BoardColor[];

export function boardBackground(color: string | null | undefined): string {
  const key = color && color in BOARD_COLORS ? (color as BoardColor) : "blue";
  return BOARD_COLORS[key];
}

/** Color de tablero determinista a partir de un id (para asignar al crear). */
export function pickBoardColor(seed: string): BoardColor {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return BOARD_COLOR_KEYS[h % BOARD_COLOR_KEYS.length];
}

/** Fondo de un tablero: su color elegido o, si no tiene, uno estable según su id. */
export function boardBackgroundFor(b: {
  id: string;
  background: string | null;
}): string {
  if (b.background && b.background in BOARD_COLORS) {
    return BOARD_COLORS[b.background as BoardColor];
  }
  return BOARD_COLORS[pickBoardColor(b.id)];
}

// Etiquetas: paleta editorial apagada, L ~0.52-0.57 → texto blanco legible encima.
export const LABEL_COLORS = {
  green: "oklch(0.53 0.09 150)",
  lime: "oklch(0.56 0.1 128)",
  amber: "oklch(0.56 0.1 65)",
  red: "oklch(0.53 0.15 30)",
  purple: "oklch(0.5 0.11 330)",
  blue: "oklch(0.52 0.09 250)",
  teal: "oklch(0.52 0.07 200)",
  pink: "oklch(0.55 0.12 350)",
} as const;

export type LabelColor = keyof typeof LABEL_COLORS;
export const LABEL_COLOR_KEYS = Object.keys(LABEL_COLORS) as LabelColor[];

export function labelBackground(color: string | null | undefined): string {
  const key = color && color in LABEL_COLORS ? (color as LabelColor) : "blue";
  return LABEL_COLORS[key];
}
