import { describe, it, expect, vi } from "vitest";
import type { Metadata } from "next";
import { renderToStaticMarkup } from "react-dom/server";

// Los módulos de página arrastran el DAL (sesión, BD) y los formularios cliente; aquí
// solo interesa el objeto `metadata` que exportan, así que se sustituyen por dobles.
// next/font es una transformación del compilador de Next y no existe fuera de él.
vi.mock("@/app/lib/dal", () => ({
  isSetupComplete: vi.fn(),
  verifySession: vi.fn(),
}));
vi.mock("@/app/lib/services/instance", () => ({ isRegistrationOpen: vi.fn() }));
vi.mock("@/app/(auth)/login/login-form", () => ({ LoginForm: () => null }));
vi.mock("@/app/setup/setup-form", () => ({ SetupForm: () => null }));
vi.mock("next/font/google", () => ({
  Bricolage_Grotesque: () => ({ variable: "" }),
  Figtree: () => ({ variable: "" }),
  Geist_Mono: () => ({ variable: "" }),
}));

/** Aplica la plantilla de título del layout raíz al título de una página. */
function resolveTitle(root: Metadata, page: Metadata): string {
  const template = root.title;
  if (!template || typeof template !== "object" || !("template" in template)) {
    throw new Error("El layout raíz debe exportar un title con template");
  }
  if (typeof page.title !== "string") throw new Error("La página debe exportar un title");
  return (template.template ?? "%s").replace("%s", page.title);
}

async function renderLogin({ registrationOpen }: { registrationOpen: boolean }) {
  const dal = await import("@/app/lib/dal");
  const instance = await import("@/app/lib/services/instance");
  vi.mocked(dal.isSetupComplete).mockResolvedValue(true);
  vi.mocked(dal.verifySession).mockResolvedValue(null);
  vi.mocked(instance.isRegistrationOpen).mockResolvedValue(registrationOpen);
  const { default: LoginPage } = await import("@/app/(auth)/login/page");
  return renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));
}

describe("metadatos de las páginas públicas", () => {
  // Antes todas las rutas compartían el título «orgtable» (WCAG 2.4.2).
  it("/login y /setup tienen títulos propios con el nombre de la app", async () => {
    const { metadata: root } = await import("@/app/layout");
    const { metadata: login } = await import("@/app/(auth)/login/page");
    const { metadata: setup } = await import("@/app/setup/page");

    expect(resolveTitle(root, login)).toBe("Iniciar sesión · orgtable");
    expect(resolveTitle(root, setup)).toBe("Configuración inicial · orgtable");
  });

  it("la descripción del layout raíz describe el producto", async () => {
    const { metadata: root } = await import("@/app/layout");
    expect(root.description).toBe("Tableros Kanban self-hosted, una alternativa a Trello");
  });

  it("la pantalla de login presenta el producto", async () => {
    const html = await renderLogin({ registrationOpen: false });
    expect(html).toContain("Tableros Kanban self-hosted");
  });

  // Término adicional 7(b) de LICENSE: la atribución tiene que verse en el pie de las
  // páginas públicas, junto al enlace al código fuente (sección 13 de la AGPL).
  it("el pie del login lleva la atribución, la licencia y el código fuente", async () => {
    const html = await renderLogin({ registrationOpen: false });
    expect(html).toMatch(/Created by <a href="https:\/\/github\.com\/Aimarmndz"[^>]*>Aimar<\/a>/);
    expect(html).toContain("AGPL-3.0-or-later");
    expect(html).toContain('href="https://github.com/Aimarmndz/orgtable"');
    expect(html).toContain('href="/legal/privacidad"');
  });

  it("el login enlaza al registro solo si está abierto", async () => {
    expect(await renderLogin({ registrationOpen: false })).not.toContain('href="/register"');
    expect(await renderLogin({ registrationOpen: true })).toContain('href="/register"');
  });
});
