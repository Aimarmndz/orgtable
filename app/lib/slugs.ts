// URL segments: /<workspace>/<board>. Pure functions shared by the server, the forms and
// the tests. The migration that introduced workspaces
// (prisma/migrations/20261015000000_workspaces) applies the same rules in SQL; keep both
// lists of reserved words in sync. See docs/workspaces.md.

// A workspace slug is the first segment after the domain, so it can never be a route of
// the app (/login, /admin…) or a word that would read as official (/support, /status).
export const RESERVED_WORKSPACE_SLUGS: ReadonlySet<string> = new Set([
  "about",
  "account",
  "admin",
  "api",
  "app",
  "auth",
  "board",
  "boards",
  "cookies",
  "dashboard",
  "docs",
  "explore",
  "forgot-password",
  "health",
  "help",
  "invite",
  "join",
  "legal",
  "login",
  "logout",
  "me",
  "new",
  "notice",
  "null",
  "org",
  "orgs",
  "orgtable",
  "pricing",
  "privacy",
  "public",
  "register",
  "reset-password",
  "root",
  "search",
  "settings",
  "setup",
  "signup",
  "static",
  "status",
  "support",
  "system",
  "terms",
  "undefined",
  "user",
  "users",
  "workspace",
  "workspaces",
  "www",
]);

// Pages of a workspace that live next to its boards (/<workspace>/settings).
export const RESERVED_BOARD_SLUGS: ReadonlySet<string> = new Set([
  "members",
  "new",
  "settings",
]);

export const WORKSPACE_SLUG_MIN = 3;
export const WORKSPACE_SLUG_MAX = 39;
export const BOARD_SLUG_MAX = 60;

// Lowercase ASCII letters and digits, single hyphens inside, none at either end.
const WORKSPACE_SLUG = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,38}$/;

/** Lowercase, accents folded, anything else collapsed into single hyphens. */
export function slugify(text: string, max: number): string {
  const ascii = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii.slice(0, max).replace(/-+$/g, "");
}

export type SlugProblem = "format" | "reserved";

/** Why a workspace slug cannot be used, or null if it can (uniqueness is the DB's job). */
export function workspaceSlugProblem(slug: string): SlugProblem | null {
  if (!WORKSPACE_SLUG.test(slug)) return "format";
  if (RESERVED_WORKSPACE_SLUGS.has(slug)) return "reserved";
  return null;
}

/** A valid starting point for a workspace slug from free text (a name, an email). */
export function workspaceSlugBase(text: string): string {
  let base = slugify(text, WORKSPACE_SLUG_MAX - 4);
  if (base.length < WORKSPACE_SLUG_MIN)
    base = slugify(`${base}-user`, WORKSPACE_SLUG_MAX - 4);
  if (base.length < WORKSPACE_SLUG_MIN) base = "user";
  return base;
}

/** A valid starting point for a board slug from its title. */
export function boardSlugBase(title: string): string {
  return slugify(title, BOARD_SLUG_MAX - 4) || "board";
}

/**
 * The first free slug among base, base-2, base-3… `isTaken` asks the database. Reserved
 * words are skipped too, so `settings` becomes `settings-2`.
 */
export async function firstFreeSlug(
  base: string,
  reserved: ReadonlySet<string>,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  for (let n = 1; n < 10_000; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (reserved.has(candidate)) continue;
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new Error(`No free slug for "${base}"`);
}

/** Path of a board: /<workspace>/<board>. Both segments are already URL-safe. */
export function boardPath(workspaceSlug: string, boardSlug: string): string {
  return `/${workspaceSlug}/${boardSlug}`;
}
