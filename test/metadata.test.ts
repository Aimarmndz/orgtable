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
vi.mock("@/app/(auth)/login/login-form", () => ({ LoginForm: () => null }));
vi.mock("@/app/setup/setup-form", () => ({ SetupForm: () => null }));
vi.mock("next/font/local", () => ({ default: () => ({ variable: "" }) }));
vi.mock("next/font/google", () => ({ Geist_Mono: () => ({ variable: "" }) }));

/** Aplica la plantilla de título del layout raíz al título de una página. */
function resolveTitle(root: Metadata, page: Metadata): string {
  const template = root.title;
  if (!template || typeof template !== "object" || !("template" in template)) {
    throw new Error("El layout raíz debe exportar un title con template");
  }
  if (typeof page.title !== "string") throw new Error("La página debe exportar un title");
  return (template.template ?? "%s").replace("%s", page.title);
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

  // La licencia vigente es la propietaria de LICENSE: la descripción no puede decir
  // open source ni AGPL.
  it("la descripción no menciona una licencia que no es la vigente", async () => {
    const { metadata: root } = await import("@/app/layout");
    expect(root.description).toBe("Tableros Kanban self-hosted, una alternativa a Trello");
    expect(root.description).not.toMatch(/open.?source|AGPL/i);
  });

  it("la pantalla de login no menciona open source ni AGPL", async () => {
    const dal = await import("@/app/lib/dal");
    vi.mocked(dal.isSetupComplete).mockResolvedValue(true);
    vi.mocked(dal.verifySession).mockResolvedValue(null);
    const { default: LoginPage } = await import("@/app/(auth)/login/page");

    const html = renderToStaticMarkup(await LoginPage());
    expect(html).toContain("Tableros Kanban self-hosted");
    expect(html).not.toMatch(/open.?source|AGPL/i);
  });
});
