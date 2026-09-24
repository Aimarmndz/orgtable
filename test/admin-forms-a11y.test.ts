import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Las acciones de servidor importan Prisma; para renderizar los formularios basta con
// sustituirlas (este test solo mira el HTML inicial, no ejecuta ninguna acción).
vi.mock("@/app/lib/actions/admin", () => ({ createUser: vi.fn() }));
vi.mock("@/app/lib/actions/tokens", () => ({ createApiToken: vi.fn() }));

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
});
