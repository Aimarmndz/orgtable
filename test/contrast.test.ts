import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Contraste WCAG AA (4,5:1 para texto normal) de los tokens de color de
// app/globals.css, en los dos temas. Se leen del propio CSS para que un cambio de
// tono que rompa el contraste falle aquí en vez de descubrirse a ojo.

const css = readFileSync(
  fileURLToPath(new URL("../app/globals.css", import.meta.url)),
  "utf8",
);

type Rgb = [number, number, number]; // sRGB lineal, 0..1

/** Tokens `--nombre: oklch(L C H)` de un bloque (`:root` o `.dark`). */
function tokens(selector: string): Record<string, Rgb> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No se encontró el bloque ${selector}`);
  const block = css.slice(start, css.indexOf("}", start));
  const out: Record<string, Rgb> = {};
  for (const m of block.matchAll(
    /--([\w-]+):\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/g,
  )) {
    out[m[1]] = oklchToLinearSrgb(Number(m[2]), Number(m[3]), Number(m[4]));
  }
  return out;
}

// Conversión OKLCH → sRGB lineal (Björn Ottosson), recortada a gama.
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

/** Color `fg` con opacidad `alpha` sobre `bg` (mezcla en sRGB, como el navegador). */
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
  ["claro", ":root"],
  ["oscuro", ".dark"],
])("contraste del tema %s", (_name, selector) => {
  const t = tokens(selector);

  it.each(TEXT)("--%s como texto sobre los fondos del cromo", (fg) => {
    for (const bg of BACKGROUNDS) {
      expect(contrast(t[fg], t[bg]), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(AA);
    }
  });

  // Avisos `bg-danger/10 text-danger` y `bg-success/10 text-success` sobre la página
  // o sobre una tarjeta, y la insignia de vencida (`bg-danger/15`) sobre la tarjeta.
  it.each([
    ["danger", 0.1, "bg"],
    ["danger", 0.1, "surface"],
    ["danger", 0.15, "surface"],
    ["success", 0.1, "bg"],
    ["success", 0.1, "surface"],
  ] as const)("--%s sobre su propio fondo al %s encima de --%s", (fg, alpha, bg) => {
    expect(contrast(t[fg], over(t[fg], t[bg], alpha))).toBeGreaterThanOrEqual(AA);
  });

  it("--accent-ink sobre --accent (botón primario)", () => {
    expect(contrast(t["accent-ink"], t.accent)).toBeGreaterThanOrEqual(AA);
  });
});
