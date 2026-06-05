// Paletas de color del CONTENIDO (no del cromo): fondos de tablero y etiquetas.
// Pensadas para Trello clásico: vibrantes y con suficiente luminosidad baja para que
// el texto blanco encima sea legible (≥4.5:1). Ver DESIGN.md.

export const BOARD_COLORS = {
  blue: "oklch(0.55 0.13 255)",
  green: "oklch(0.56 0.12 155)",
  purple: "oklch(0.52 0.15 300)",
  amber: "oklch(0.62 0.13 70)",
  rose: "oklch(0.57 0.16 8)",
  teal: "oklch(0.56 0.09 195)",
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

// Etiquetas: todas con L ~0.55-0.64 → texto blanco legible encima.
export const LABEL_COLORS = {
  green: "oklch(0.6 0.14 150)",
  lime: "oklch(0.62 0.14 130)",
  amber: "oklch(0.64 0.13 70)",
  red: "oklch(0.58 0.2 25)",
  purple: "oklch(0.55 0.16 300)",
  blue: "oklch(0.58 0.15 255)",
  teal: "oklch(0.58 0.1 195)",
  pink: "oklch(0.6 0.18 350)",
} as const;

export type LabelColor = keyof typeof LABEL_COLORS;
export const LABEL_COLOR_KEYS = Object.keys(LABEL_COLORS) as LabelColor[];

export function labelBackground(color: string | null | undefined): string {
  const key = color && color in LABEL_COLORS ? (color as LabelColor) : "blue";
  return LABEL_COLORS[key];
}
