// Public landing page at `/` (app/components/landing/). It presents orgtable to visitors
// without a session: what it is, that they can use this instance for free and how to
// install their own. See docs/landing.md.
//
// Both values are read on every request (not at build time) so the Docker image honours
// them, and a bad value fails with its reason instead of being silently ignored.

export const LANDING_MODES = ["auto", "on", "off"] as const;
export type LandingMode = (typeof LANDING_MODES)[number];

/**
 * ORGTABLE_LANDING: `auto` (default) shows the landing only while sign-up is open, so a
 * private instance keeps sending visitors straight to the sign-in screen; `on` always
 * shows it; `off` never does.
 */
export function landingMode(
  raw: string | undefined = process.env.ORGTABLE_LANDING,
): LandingMode {
  const value = raw?.trim().toLowerCase();
  if (!value) return "auto";
  if ((LANDING_MODES as readonly string[]).includes(value))
    return value as LandingMode;
  throw new Error(
    `ORGTABLE_LANDING must be one of ${LANDING_MODES.join(", ")} ("${raw}")`,
  );
}

/** Whether `/` shows the landing to a visitor without a session. */
export function shouldShowLanding(
  mode: LandingMode,
  registrationOpen: boolean,
): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  return registrationOpen;
}

// The installer of the original repository (install.sh). A fork that publishes its own
// installer points ORGTABLE_INSTALL_URL to it.
const DEFAULT_INSTALL_URL =
  "https://raw.githubusercontent.com/Aimarmndz/orgtable/main/install.sh";

/** URL of the install script the landing tells visitors to run. Only https. */
export function installScriptUrl(
  raw: string | undefined = process.env.ORGTABLE_INSTALL_URL,
): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_INSTALL_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`ORGTABLE_INSTALL_URL is not a valid URL: "${raw}"`);
  }
  // Visitors pipe this into a shell: plain http would let anyone on the path change it.
  if (url.protocol !== "https:") {
    throw new Error(`ORGTABLE_INSTALL_URL must start with https:// ("${raw}")`);
  }
  // It is pasted unquoted into a shell: no character the shell would interpret (; | & $ `
  // quotes, spaces…), so the copied command does exactly what it shows.
  const href = url.toString();
  if (!/^[A-Za-z0-9._~:/?=%+,@-]+$/.test(href)) {
    throw new Error(
      `ORGTABLE_INSTALL_URL has characters a shell would interpret ("${raw}")`,
    );
  }
  return href;
}

/** The one-line install command shown (and copied) on the landing. */
export function installCommand(scriptUrl: string): string {
  return `curl -fsSL ${scriptUrl} | bash`;
}

/**
 * Link to a file of the documentation in the instance's source repository. On GitHub it
 * points at the file on `main`; on any other forge it falls back to the repository itself,
 * whose README links the docs.
 */
export function docUrl(sourceUrl: string, path: string): string {
  const url = new URL(sourceUrl);
  if (url.hostname !== "github.com") return sourceUrl;
  return `${sourceUrl.replace(/\/+$/, "")}/blob/main/${path}`;
}
