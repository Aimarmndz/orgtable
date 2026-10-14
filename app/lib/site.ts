import packageJson from "@/package.json";

// Datos del proyecto que la interfaz muestra como «avisos legales apropiados» de la AGPL
// (pie de las páginas públicas y «Acerca de» en los ajustes). La atribución es un término
// adicional de LICENSE (sección 7(b)): no se puede quitar ni cambiar en versiones
// derivadas. Ver docs/DECISIONES.md (2026-10-14).

export const APP_VERSION: string = packageJson.version;

export const AUTHOR_NAME = "Aimar";
export const AUTHOR_URL = "https://github.com/Aimarmndz";

export const LICENSE_NAME = "AGPL-3.0-or-later";
export const LICENSE_URL = "https://www.gnu.org/licenses/agpl-3.0.html";

// Código fuente de ESTA instancia. La AGPL (sección 13) obliga a ofrecérselo a quien usa
// la app por red: si despliegas una versión modificada, apunta ORGTABLE_SOURCE_URL a tu
// fork. Se lee en cada render (no en el build) para que la imagen Docker lo respete.
const DEFAULT_SOURCE_URL = "https://github.com/Aimarmndz/orgtable";

export function sourceCodeUrl(): string {
  const raw = process.env.ORGTABLE_SOURCE_URL?.trim();
  if (!raw) return DEFAULT_SOURCE_URL;
  // Va a un href: solo http(s), para que un valor mal puesto no acabe en «javascript:».
  // Se falla con el motivo en vez de volver en silencio al repositorio original, que
  // dejaría la instancia modificada sin ofrecer su propio código.
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`ORGTABLE_SOURCE_URL no es una URL válida: "${raw}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`ORGTABLE_SOURCE_URL debe empezar por https:// o http:// ("${raw}")`);
  }
  return url.toString();
}
