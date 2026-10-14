import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import type { Locale } from "@/app/i18n/config";

// The page modules drag in the DAL (session, DB), Prisma and the client forms; here only
// their metadata and the public footer matter, so those are replaced with doubles.
// next/font is a transformation of Next's compiler and does not exist outside it.
vi.mock("@/app/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/app/lib/dal", () => ({
  isSetupComplete: vi.fn(),
  verifySession: vi.fn(),
}));
vi.mock("@/app/lib/services/instance", () => ({
  isRegistrationOpen: vi.fn(),
  getLegalInfo: vi.fn(),
}));
// The language picker in the footer posts to this Server Action (cookies + Prisma).
vi.mock("@/app/lib/actions/locale", () => ({ setLocale: vi.fn() }));
vi.mock("@/app/(auth)/login/login-form", () => ({ LoginForm: () => null }));
vi.mock("@/app/setup/setup-form", () => ({ SetupForm: () => null }));
vi.mock("next/font/google", () => ({
  Bricolage_Grotesque: () => ({ variable: "" }),
  Figtree: () => ({ variable: "" }),
  Geist_Mono: () => ({ variable: "" }),
}));

// getI18n() reads the request's cookies and headers, which do not exist outside Next.
// The language of the "request" is set per test (English unless a test changes it).
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

beforeEach(() => {
  request.locale = "en";
});

type MetadataModule = { generateMetadata: () => Promise<Metadata> };

/** Applies the root layout's title template to a page's title. */
async function resolveTitle(page: MetadataModule): Promise<string> {
  const { generateMetadata: rootMetadata } = await import("@/app/layout");
  const template = (await rootMetadata()).title;
  if (!template || typeof template !== "object" || !("template" in template)) {
    throw new Error("The root layout must export a title with a template");
  }
  const { title } = await page.generateMetadata();
  if (typeof title !== "string") throw new Error("The page must export a title");
  return (template.template ?? "%s").replace("%s", title);
}

/** HTML of a tree with async Server Components (renderToStaticMarkup does not await them). */
async function renderHtml(node: ReactNode): Promise<string> {
  const { prelude } = await prerender(node);
  return new Response(prelude).text();
}

async function renderLogin({ registrationOpen }: { registrationOpen: boolean }) {
  const dal = await import("@/app/lib/dal");
  const instance = await import("@/app/lib/services/instance");
  vi.mocked(dal.isSetupComplete).mockResolvedValue(true);
  vi.mocked(dal.verifySession).mockResolvedValue(null);
  vi.mocked(instance.isRegistrationOpen).mockResolvedValue(registrationOpen);
  const { default: LoginPage } = await import("@/app/(auth)/login/page");
  return renderHtml(await LoginPage({ searchParams: Promise.resolve({}) }));
}

describe("metadata of the public pages", () => {
  // Every route used to share the title "orgtable" (WCAG 2.4.2).
  it("/login and /setup have their own titles with the app name", async () => {
    expect(await resolveTitle(await import("@/app/(auth)/login/page"))).toBe(
      "Sign in · orgtable",
    );
    expect(await resolveTitle(await import("@/app/setup/page"))).toBe(
      "Initial setup · orgtable",
    );
  });

  it("each legal page has its own title with the app name", async () => {
    expect(await resolveTitle(await import("@/app/(public)/legal/privacy/page"))).toBe(
      "Privacy policy · orgtable",
    );
    expect(await resolveTitle(await import("@/app/(public)/legal/terms/page"))).toBe(
      "Terms of use · orgtable",
    );
    expect(await resolveTitle(await import("@/app/(public)/legal/cookies/page"))).toBe(
      "Cookie policy · orgtable",
    );
    expect(await resolveTitle(await import("@/app/(public)/legal/notice/page"))).toBe(
      "Legal notice · orgtable",
    );
  });

  it("titles follow the visitor's language", async () => {
    request.locale = "es";
    expect(await resolveTitle(await import("@/app/(auth)/login/page"))).toBe(
      "Iniciar sesión · orgtable",
    );
  });

  it("the root layout's description describes the product", async () => {
    const { generateMetadata } = await import("@/app/layout");
    expect((await generateMetadata()).description).toBe(
      "Self-hosted Kanban boards, a Trello alternative",
    );
    request.locale = "es";
    expect((await generateMetadata()).description).toBe(
      "Tableros Kanban self-hosted, una alternativa a Trello",
    );
  });

  it("the login screen presents the product", async () => {
    const html = await renderLogin({ registrationOpen: false });
    expect(html).toContain("Self-hosted, open-source Kanban boards");
  });

  // Additional term 7(b) of LICENSE: the attribution must be visible in the footer of the
  // public pages, next to the source code link (AGPL section 13).
  it("the login footer carries the attribution, the license and the source code", async () => {
    const html = await renderLogin({ registrationOpen: false });
    expect(html).toMatch(/Created by <a href="https:\/\/github\.com\/Aimarmndz"[^>]*>Aimar<\/a>/);
    expect(html).toMatch(
      /<a href="https:\/\/www\.gnu\.org\/licenses\/agpl-3\.0\.html"[^>]*>AGPL-3\.0-or-later<\/a>/,
    );
    expect(html).toMatch(/<a href="https:\/\/github\.com\/Aimarmndz\/orgtable"[^>]*>Source code<\/a>/);
    for (const route of ["privacy", "terms", "cookies", "notice"]) {
      expect(html).toContain(`href="/legal/${route}"`);
    }
  });

  it("the attribution keeps the author's name in every language", async () => {
    request.locale = "es";
    const html = await renderLogin({ registrationOpen: false });
    expect(html).toMatch(/<a href="https:\/\/github\.com\/Aimarmndz"[^>]*>Aimar<\/a>/);
    expect(html).toContain("AGPL-3.0-or-later");
  });

  it("the login links to sign-up only when registration is open", async () => {
    expect(await renderLogin({ registrationOpen: false })).not.toContain('href="/register"');
    expect(await renderLogin({ registrationOpen: true })).toContain('href="/register"');
  });
});
