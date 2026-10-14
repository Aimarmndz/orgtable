// Nombre legible de un navegador a partir de su user-agent, para la lista de sesiones de
// /settings («Firefox en macOS»). Heurística mínima sin dependencias: el orden importa
// porque casi todos los navegadores incluyen «Safari» y los Chromium incluyen «Chrome».

const BROWSERS: [RegExp, string][] = [
  [/Edg(A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/Windows/, "Windows"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

export function describeUserAgent(ua: string | null): string {
  if (!ua) return "Navegador desconocido";
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  if (browser && system) return `${browser} en ${system}`;
  return browser ?? system ?? "Navegador desconocido";
}
