import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Las acciones de servidor importan Prisma; para renderizar los formularios basta con
// sustituirlas (este test solo mira el HTML inicial, no ejecuta ninguna acción).
vi.mock("@/app/lib/actions/admin", () => ({ createUser: vi.fn() }));
vi.mock("@/app/lib/actions/tokens", () => ({ createApiToken: vi.fn() }));

// En el render de servidor useActionState siempre devuelve el estado inicial. Para
// mirar el HTML con un token recién creado se sustituye solo cuando el test lo pide.
const actionState = vi.hoisted(() => ({ override: null as unknown }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useActionState: ((...args: Parameters<typeof react.useActionState>) =>
      actionState.override === null
        ? react.useActionState(...args)
        : [actionState.override, () => {}, false]) as typeof react.useActionState,
  };
});
afterEach(() => {
  actionState.override = null;
});

const { CreateUserForm } = await import(
  "@/app/(app)/admin/users/create-user-form"
);
const { CreateTokenForm } = await import(
  "@/app/(app)/settings/create-token-form"
);

describe("formularios de administración y ajustes — accesibilidad", () => {
  it("crear usuario monta la región role=status antes de que llegue el aviso", () => {
    const html = renderToStaticMarkup(createElement(CreateUserForm));
    expect(html).toContain('role="status"');
  });

  it("crear token monta la región role=status y el select conserva su valor inicial", () => {
    const html = renderToStaticMarkup(createElement(CreateTokenForm));
    expect(html).toContain('role="status"');
    expect(html).toMatch(/<option value="full" selected="">/);
  });

  it("con un token creado, la región role=status no contiene el token ni el botón", () => {
    const token = "ot_token-secreto-de-prueba";
    actionState.override = { token, name: "CI" };
    const html = renderToStaticMarkup(createElement(CreateTokenForm));
    const status = html.match(/<div role="status">(.*?)<\/div>/);
    expect(status).not.toBeNull();
    expect(status![1]).toContain("Token «CI» creado");
    expect(status![1]).not.toContain(token);
    expect(status![1]).not.toContain("<button");
    // El token sigue visible fuera de la región viva.
    expect(html).toContain(`>${token}</code>`);
  });
});
