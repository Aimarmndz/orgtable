// Readable browser name from a user-agent, for the session list in /settings ("Firefox on
// macOS"). Minimal heuristic without dependencies: order matters because nearly every
// browser includes "Safari" and every Chromium includes "Chrome".

import { fmt } from "@/app/i18n/format";

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

/** Browser and operating system detected in a user-agent; null for what is not recognised. */
export function parseUserAgent(ua: string | null): { browser: string | null; os: string | null } {
  if (!ua) return { browser: null, os: null };
  return {
    browser: BROWSERS.find(([re]) => re.test(ua))?.[1] ?? null,
    os: SYSTEMS.find(([re]) => re.test(ua))?.[1] ?? null,
  };
}

/**
 * Readable description in the reader's language. `text.browserOnOs` is a template with
 * {browser} and {os} ("{browser} on {os}"); `text.unknownBrowser` is used when neither is
 * recognised. Pass `m.settings.security`, which has both.
 */
export function describeUserAgent(
  ua: string | null,
  text: { browserOnOs: string; unknownBrowser: string },
): string {
  const { browser, os } = parseUserAgent(ua);
  if (browser && os) return fmt(text.browserOnOs, { browser, os });
  return browser ?? os ?? text.unknownBrowser;
}
