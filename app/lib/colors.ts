// CONTENT colour palettes (not the chrome): board backgrounds and labels.
// Warm editorial look: muted, refined tones (clay, olive, plum, ochre, brick, slate)
// that sit well with the terracotta accent. Low lightness (L≤0.54) so white text on
// top stays readable. See DESIGN.md.

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

/** Deterministic board colour from an id (assigned on creation). */
export function pickBoardColor(seed: string): BoardColor {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return BOARD_COLOR_KEYS[h % BOARD_COLOR_KEYS.length];
}

/** A board's background: its chosen colour or, if none, a stable one based on its id. */
export function boardBackgroundFor(b: {
  id: string;
  background: string | null;
}): string {
  // Object.hasOwn rather than `in`: `in` accepts prototype keys ('constructor',
  // 'toString'…) and would return a function instead of a colour.
  if (b.background && Object.hasOwn(BOARD_COLORS, b.background)) {
    return BOARD_COLORS[b.background as BoardColor];
  }
  return BOARD_COLORS[pickBoardColor(b.id)];
}

// Labels: muted editorial palette, L ~0.52-0.57 → white text readable on top.
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
  // Object.hasOwn, not `in`: see boardBackgroundFor.
  const key =
    color && Object.hasOwn(LABEL_COLORS, color) ? (color as LabelColor) : "blue";
  return LABEL_COLORS[key];
}
