import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Las acciones de servidor importan Prisma; para renderizar los formularios basta con
// sustituirlas (este test solo mira el HTML, no ejecuta ninguna acción).
vi.mock("@/app/lib/actions/admin", () => ({ createUser: vi.fn() }));
vi.mock("@/app/lib/actions/tokens", () => ({ createApiToken: vi.fn() }));
vi.mock("@/app/lib/actions/boards", () => ({ importBoard: vi.fn() }));

// En el render de servidor useActionState siempre devuelve el estado inicial. Aquí se
// sustituye por un estado con error, y se marca pending cuando el test lo pide.
const actionState = vi.hoisted(() => ({
  override: null as unknown,
  pending: false,
}));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useActionState: ((...args: Parameters<typeof react.useActionState>) =>
      actionState.override === null
        ? react.useActionState(...args)
        : [actionState.override, () => {}, actionState.pending]) as typeof react.useActionState,
  };
});
afterEach(() => {
  actionState.override = null;
  actionState.pending = false;
});

const { CreateUserForm } = await import(
  "@/app/(app)/admin/users/create-user-form"
);
const { CreateTokenForm } = await import(
  "@/app/(app)/settings/create-token-form"
);
const { ImportBoardForm } = await import("@/app/(app)/boards/import-board-form");

const forms: [string, FunctionComponent, object][] = [
  [
    "crear usuario",
    CreateUserForm,
    {
      error: "Ya existe una cuenta con ese email.",
      field: "email",
      values: { name: "Ana", email: "ana@ejemplo.com", role: "MEMBER" },
    },
  ],
  [
    "crear token",
    CreateTokenForm,
    {
      error: "El nombre es obligatorio.",
      values: { name: "", scope: "read", expiry: "30" },
    },
  ],
  ["importar tablero", ImportBoardForm, { error: "El archivo no es un JSON válido." }],
];

describe("formularios con aviso de error — reanuncio de un error repetido", () => {
  it.each(forms)(
    "%s retira el aviso role=alert mientras se envía",
    (_name, Form, state) => {
      actionState.override = state;
      expect(renderToStaticMarkup(createElement(Form))).toContain('role="alert"');

      // Si el nodo siguiera montado con el mismo texto, un segundo error idéntico no
      // cambiaría el DOM y el lector de pantalla no lo anunciaría.
      actionState.pending = true;
      expect(renderToStaticMarkup(createElement(Form))).not.toContain('role="alert"');
    },
  );

  it("crear usuario no apunta aria-describedby a un aviso retirado", () => {
    // Etiqueta <input> del email, sea cual sea el orden de sus atributos.
    const emailInput = (html: string) => html.match(/<input[^>]*name="email"[^>]*>/)?.[0];

    actionState.override = forms[0][2];
    expect(emailInput(renderToStaticMarkup(createElement(CreateUserForm)))).toMatch(
      /aria-describedby="[^"]+"/,
    );

    actionState.pending = true;
    expect(emailInput(renderToStaticMarkup(createElement(CreateUserForm)))).not.toMatch(
      /aria-describedby=/,
    );
  });
});
