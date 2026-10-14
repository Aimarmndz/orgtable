import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import type { Locale } from "@/app/i18n/config";
import {
  docUrl,
  installCommand,
  installScriptUrl,
  landingMode,
  shouldShowLanding,
} from "@/app/lib/landing";

// The public landing at `/` (docs/landing.md): when it shows, what it promises depending on
// the instance's sign-up, and the install command it tells visitors to paste into a shell.

describe("landingMode (ORGTABLE_LANDING)", () => {
  it("defaults to auto", () => {
    expect(landingMode(undefined)).toBe("auto");
    expect(landingMode("  ")).toBe("auto");
  });

  it("accepts on, off and auto in any case", () => {
    expect(landingMode("ON")).toBe("on");
    expect(landingMode(" off ")).toBe("off");
    expect(landingMode("Auto")).toBe("auto");
  });

  it("fails with the reason on any other value", () => {
    expect(() => landingMode("yes")).toThrow(
      /ORGTABLE_LANDING must be one of auto, on, off/,
    );
  });
});

describe("shouldShowLanding", () => {
  it("auto follows sign-up: a private instance keeps going straight to sign-in", () => {
    expect(shouldShowLanding("auto", true)).toBe(true);
    expect(shouldShowLanding("auto", false)).toBe(false);
  });

  it("on and off ignore sign-up", () => {
    expect(shouldShowLanding("on", false)).toBe(true);
    expect(shouldShowLanding("off", true)).toBe(false);
  });
});

describe("installScriptUrl (ORGTABLE_INSTALL_URL)", () => {
  it("defaults to the original repository's installer", () => {
    expect(installScriptUrl(undefined)).toBe(
      "https://raw.githubusercontent.com/Aimarmndz/orgtable/main/install.sh",
    );
  });

  it("accepts a fork's installer", () => {
    expect(
      installScriptUrl("https://example.org/me/orgtable/raw/main/install.sh"),
    ).toBe("https://example.org/me/orgtable/raw/main/install.sh");
  });

  // Visitors pipe it into bash: a URL that is not https, or that the shell would split,
  // is refused instead of being shown.
  it("refuses anything but https", () => {
    expect(() => installScriptUrl("http://example.org/install.sh")).toThrow(
      /https/,
    );
    expect(() => installScriptUrl("javascript:alert(1)")).toThrow(/https/);
    expect(() => installScriptUrl("not a url")).toThrow(/not a valid URL/);
  });

  it("refuses characters a shell would interpret", () => {
    for (const bad of [
      "https://example.org/i.sh;rm",
      "https://example.org/i.sh|sh",
      "https://example.org/i.sh&x=1",
      "https://example.org/$(id)",
      "https://example.org/a'b",
    ]) {
      expect(() => installScriptUrl(bad), bad).toThrow(/shell/);
    }
    // What the URL parser percent-encodes is inert for the shell, so it is accepted.
    expect(installScriptUrl("https://example.org/`id` x.sh")).toBe(
      "https://example.org/%60id%60%20x.sh",
    );
  });

  it("builds the one-line command", () => {
    expect(installCommand("https://example.org/install.sh")).toBe(
      "curl -fsSL https://example.org/install.sh | bash",
    );
  });
});

describe("docUrl", () => {
  it("points at the file on GitHub, and at the repository elsewhere", () => {
    expect(
      docUrl("https://github.com/Aimarmndz/orgtable", "docs/self-hosting.md"),
    ).toBe(
      "https://github.com/Aimarmndz/orgtable/blob/main/docs/self-hosting.md",
    );
    expect(
      docUrl("https://codeberg.org/me/orgtable", "docs/self-hosting.md"),
    ).toBe("https://codeberg.org/me/orgtable");
  });
});

// --- The page at `/` -----------------------------------------------------------------
// Same doubles as test/metadata.test.ts: the DAL, Prisma and the request's language do
// not exist outside Next, and next/font is a compiler transformation.
vi.mock("@/app/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/app/lib/dal", () => ({
  isSetupComplete: vi.fn(),
  verifySession: vi.fn(),
}));
vi.mock("@/app/lib/services/instance", () => ({
  isRegistrationOpen: vi.fn(),
  getLegalInfo: vi.fn(),
}));
vi.mock("@/app/lib/actions/locale", () => ({ setLocale: vi.fn() }));
vi.mock("next/font/google", () => ({
  Bricolage_Grotesque: () => ({ variable: "" }),
  Figtree: () => ({ variable: "" }),
  Geist_Mono: () => ({ variable: "" }),
  Silkscreen: () => ({ variable: "" }),
  VT323: () => ({ variable: "" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));
const request = vi.hoisted(() => ({ locale: "en" as Locale }));
vi.mock("@/app/i18n/server", async () => {
  const { languageInfo, messagesFor } = await import("@/app/i18n/config");
  return {
    getI18n: async () => ({
      locale: request.locale,
      intl: languageInfo(request.locale).intl,
      m: messagesFor(request.locale),
    }),
  };
});

async function renderHtml(node: ReactNode): Promise<string> {
  const { prelude } = await prerender(node);
  return new Response(prelude).text();
}

async function home({
  setup = true,
  session = false,
  registrationOpen = true,
}: { setup?: boolean; session?: boolean; registrationOpen?: boolean } = {}) {
  const dal = await import("@/app/lib/dal");
  const instance = await import("@/app/lib/services/instance");
  vi.mocked(dal.isSetupComplete).mockResolvedValue(setup);
  vi.mocked(dal.verifySession).mockResolvedValue(
    session
      ? ({ userId: "u1" } as Awaited<ReturnType<typeof dal.verifySession>>)
      : null,
  );
  vi.mocked(instance.isRegistrationOpen).mockResolvedValue(registrationOpen);
  const { default: Home } = await import("@/app/page");
  return Home();
}

describe("the page at /", () => {
  const env = { ...process.env };
  beforeEach(() => {
    request.locale = "en";
    delete process.env.ORGTABLE_LANDING;
    delete process.env.ORGTABLE_INSTALL_URL;
    delete process.env.ORGTABLE_SOURCE_URL;
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it("sends an unconfigured instance to the wizard and a signed-in user to the boards", async () => {
    await expect(home({ setup: false })).rejects.toThrow("redirect:/setup");
    await expect(home({ session: true })).rejects.toThrow("redirect:/boards");
  });

  it("a private instance (sign-up closed, auto) goes straight to sign-in", async () => {
    await expect(home({ registrationOpen: false })).rejects.toThrow(
      "redirect:/login",
    );
  });

  it("ORGTABLE_LANDING=off never shows it, =on always does", async () => {
    process.env.ORGTABLE_LANDING = "off";
    await expect(home()).rejects.toThrow("redirect:/login");
    process.env.ORGTABLE_LANDING = "on";
    const html = await renderHtml(await home({ registrationOpen: false }));
    expect(html).toContain("Your server.");
  });

  it("with sign-up open it offers a free account and the install command", async () => {
    const html = await renderHtml(await home());
    expect(html).toContain("Your boards.");
    expect(html).toContain('href="/register"');
    expect(html).toContain("Create a free account");
    expect(html).toContain(
      "curl -fsSL https://raw.githubusercontent.com/Aimarmndz/orgtable/main/install.sh | bash",
    );
    expect(html).toContain(
      'href="https://github.com/Aimarmndz/orgtable/blob/main/docs/self-hosting.md"',
    );
  });

  it("with sign-up closed it does not promise a free account", async () => {
    process.env.ORGTABLE_LANDING = "on";
    const html = await renderHtml(await home({ registrationOpen: false }));
    expect(html).not.toContain('href="/register"');
    expect(html).not.toContain("Create a free account");
    expect(html).toContain("Sign-up is paused on this instance right now.");
  });

  it("uses the instance's own installer and source code", async () => {
    process.env.ORGTABLE_INSTALL_URL = "https://example.org/fork/install.sh";
    process.env.ORGTABLE_SOURCE_URL = "https://example.org/fork";
    const html = await renderHtml(await home());
    expect(html).toContain(
      "curl -fsSL https://example.org/fork/install.sh | bash",
    );
    expect(html).toContain('href="https://example.org/fork"');
    expect(html).not.toContain("raw.githubusercontent.com");
  });

  // Additional term 7(b) of LICENSE: the attribution and the source code link (AGPL
  // section 13) are in the footer of every public page, the landing included.
  it("the footer carries the attribution, the license and the source code", async () => {
    const html = await renderHtml(await home());
    expect(html).toMatch(
      /Created by <a href="https:\/\/github\.com\/Aimarmndz"[^>]*>Aimar<\/a>/,
    );
    expect(html).toContain("AGPL-3.0-or-later");
    expect(html).toMatch(
      /<a href="https:\/\/github\.com\/Aimarmndz\/orgtable"[^>]*>Source code<\/a>/,
    );
  });

  it("follows the visitor's language", async () => {
    request.locale = "es";
    const html = await renderHtml(await home());
    expect(html).toContain("Tus tableros.");
    expect(html).toContain("Crear cuenta gratis");
  });

  it("has a skip link, one h1 and labelled sections", async () => {
    const html = await renderHtml(await home());
    expect(html).toContain('href="#main"');
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    for (const id of ["features", "paths", "install"]) {
      expect(html).toContain(`aria-labelledby="${id}-title"`);
    }
  });
});
