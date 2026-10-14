import packageJson from "@/package.json";

// Project data the interface shows as the AGPL "Appropriate Legal Notices" (footer of the
// public pages and "About" in settings). The attribution is an additional term of LICENSE
// (section 7(b)): it cannot be removed or changed in derived versions. See
// docs/DECISIONES.md (2026-10-14).

export const APP_VERSION: string = packageJson.version;

export const AUTHOR_NAME = "Aimar";
export const AUTHOR_URL = "https://github.com/Aimarmndz";

export const LICENSE_NAME = "AGPL-3.0-or-later";
export const LICENSE_URL = "https://www.gnu.org/licenses/agpl-3.0.html";

// Source code of THIS instance. The AGPL (section 13) requires offering it to whoever uses
// the app over a network: if you deploy a modified version, point ORGTABLE_SOURCE_URL to
// your fork. Read on every render (not at build time) so the Docker image honours it.
const DEFAULT_SOURCE_URL = "https://github.com/Aimarmndz/orgtable";

export function sourceCodeUrl(): string {
  const raw = process.env.ORGTABLE_SOURCE_URL?.trim();
  if (!raw) return DEFAULT_SOURCE_URL;
  // It ends up in an href: only http(s), so a bad value never becomes "javascript:". It
  // fails with the reason instead of silently falling back to the original repository,
  // which would leave a modified instance without offering its own code.
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`ORGTABLE_SOURCE_URL is not a valid URL: "${raw}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`ORGTABLE_SOURCE_URL must start with https:// or http:// ("${raw}")`);
  }
  return url.toString();
}
