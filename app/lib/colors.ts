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
  // Picked by hand only (board menu → Background): the automatic colour below keeps
  // drawing from the first six, so boards without a chosen colour never change.
  slate: "oklch(0.42 0.02 260)",
  ink: "oklch(0.32 0.03 52)",
} as const;

export type BoardColor = keyof typeof BOARD_COLORS;
export const BOARD_COLOR_KEYS = Object.keys(BOARD_COLORS) as BoardColor[];
// The palette pickBoardColor draws from. Frozen at the original six: adding a colour to
// BOARD_COLORS must not repaint every board, avatar and team that relies on the
// automatic one.
const AUTO_BOARD_COLORS: BoardColor[] = ["blue", "green", "purple", "amber", "rose", "teal"];

/** Deterministic board colour from an id (assigned on creation). */
export function pickBoardColor(seed: string): BoardColor {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AUTO_BOARD_COLORS[h % AUTO_BOARD_COLORS.length];
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

// Besides the palette, a label may take any colour as "#rrggbb" (the colour picker). Only
// that exact shape is accepted: the value ends up in a style attribute.
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function labelBackground(color: string | null | undefined): string {
  if (color && HEX_COLOR.test(color)) return color.toLowerCase();
  // Object.hasOwn, not `in`: see boardBackgroundFor.
  const key =
    color && Object.hasOwn(LABEL_COLORS, color) ? (color as LabelColor) : "blue";
  return LABEL_COLORS[key];
}

const INK = "#2b2118";

/**
 * Text colour on top of a label: white on the palette (built for it), and on a free colour
 * whichever of white or ink contrasts more (WCAG relative luminance), so a pale yellow
 * still reads.
 */
export function labelText(color: string | null | undefined): string {
  if (!color || !HEX_COLOR.test(color)) return "#ffffff";
  const lum = relativeLuminance(color);
  const onWhite = 1.05 / (lum + 0.05);
  const onInk = (lum + 0.05) / (relativeLuminance(INK) + 0.05);
  return onWhite >= onInk ? "#ffffff" : INK;
}

function relativeLuminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
