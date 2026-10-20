// Conversions behind the colour picker (app/components/ui/color-picker.tsx). Pure, so they
// are unit tested. HSV with h in [0, 360), s and v in [0, 1]; hex as "#rrggbb".

export type Hsv = { h: number; s: number; v: number };

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const byte = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${byte(f(5))}${byte(f(3))}${byte(f(1))}`;
}

/** Null if it is not "#rrggbb". The hue of a grey is 0: callers keep their own. */
export function hexToHsv(hex: string): Hsv | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

/** "f54927", "#F54927" or "#f54" → "#f54927"; null if it is not a colour. */
export function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(raw)) return `#${[...raw].map((c) => c + c).join("")}`;
  return /^[0-9a-f]{6}$/.test(raw) ? `#${raw}` : null;
}

/**
 * "oklch(L C H)" (how the palettes in colors.ts are written) → "#rrggbb", clipped to sRGB.
 * Null for anything else. Through OKLab and linear sRGB (Björn Ottosson's matrices).
 */
export function oklchToHex(css: string): string | null {
  const m = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(css.trim());
  if (!m) return null;
  const [l, c, h] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const byte = (x: number) => {
    const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${linear.map(byte).join("")}`;
}
