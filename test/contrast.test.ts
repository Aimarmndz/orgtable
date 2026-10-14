import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// WCAG AA contrast (4.5:1 for normal text) of the colour tokens in app/globals.css, in
// both themes. They are read from the CSS itself so that a change of tone that breaks
// the contrast fails here instead of being discovered by eye.

const css = readFileSync(
  fileURLToPath(new URL("../app/globals.css", import.meta.url)),
  "utf8",
);

type Rgb = [number, number, number]; // linear sRGB, 0..1

/**
 * `--name: oklch(L C H)` tokens of every block with that selector (`:root` or `.dark`),
 * in order: the app's tokens and the landing's (a later block of its own).
 */
function tokens(selector: string): Record<string, Rgb> {
  const out: Record<string, Rgb> = {};
  let start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`Block not found: ${selector}`);
  while (start !== -1) {
    const block = css.slice(start, css.indexOf("}", start));
    for (const m of block.matchAll(
      /--([\w-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/g,
    )) {
      out[m[1]] = oklchToLinearSrgb(Number(m[2]), Number(m[3]), Number(m[4]));
    }
    start = css.indexOf(`${selector} {`, start + 1);
  }
  return out;
}

// OKLCH → linear sRGB conversion (Björn Ottosson), clipped to gamut.
function oklchToLinearSrgb(L: number, C: number, H: number): Rgb {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const encode = (v: number) =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
const decode = (v: number) =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;

/** Colour `fg` with opacity `alpha` over `bg` (blended in sRGB, like the browser). */
function over(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return fg.map((c, i) =>
    decode(encode(c) * alpha + encode(bg[i]) * (1 - alpha)),
  ) as Rgb;
}

function contrast(a: Rgb, b: Rgb): number {
  const lum = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;
const TEXT = ["ink", "ink-muted", "accent", "danger", "success"];
const BACKGROUNDS = ["bg", "surface", "surface-2", "column"];

describe.each([
  ["light", ":root"],
  ["dark", ".dark"],
])("contrast of the %s theme", (_name, selector) => {
  const t = tokens(selector);

  it.each(TEXT)("--%s as text over the chrome backgrounds", (fg) => {
    for (const bg of BACKGROUNDS) {
      expect(contrast(t[fg], t[bg]), `${fg} over ${bg}`).toBeGreaterThanOrEqual(AA);
    }
  });

  // `bg-danger/10 text-danger` and `bg-success/10 text-success` messages over the page or
  // over a card, and the overdue badge (`bg-danger/15`) over the card.
  it.each([
    ["danger", 0.1, "bg"],
    ["danger", 0.1, "surface"],
    ["danger", 0.15, "surface"],
    ["success", 0.1, "bg"],
    ["success", 0.1, "surface"],
  ] as const)("--%s over its own background at %s on top of --%s", (fg, alpha, bg) => {
    expect(contrast(t[fg], over(t[fg], t[bg], alpha))).toBeGreaterThanOrEqual(AA);
  });

  it("--accent-ink over --accent (primary button)", () => {
    expect(contrast(t["accent-ink"], t.accent)).toBeGreaterThanOrEqual(AA);
  });
});

// The landing's terminal (app/components/landing/) is dark in both themes, so its tokens
// live only in :root. The command is the text people must read and copy: AAA (7:1).
describe("contrast of the landing's terminal", () => {
  const t = tokens(":root");

  it("--phosphor (the command) over --terminal reaches 7:1", () => {
    expect(contrast(t.phosphor, t.terminal)).toBeGreaterThanOrEqual(7);
  });

  it.each(["phosphor-dim", "phosphor-ok"])("--%s over --terminal", (fg) => {
    expect(contrast(t[fg], t.terminal)).toBeGreaterThanOrEqual(AA);
  });

  it("--terminal (copy button text) over --phosphor", () => {
    expect(contrast(t.terminal, t.phosphor)).toBeGreaterThanOrEqual(AA);
  });
});
