import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { withI18n } from "./helpers/i18n";

// The server actions import Prisma; replacing them is enough to render the forms (this
// test only looks at the HTML, it does not run any action).
vi.mock("@/app/lib/actions/admin", () => ({ createUser: vi.fn() }));
vi.mock("@/app/lib/actions/tokens", () => ({ createApiToken: vi.fn() }));
vi.mock("@/app/lib/actions/boards", () => ({ importBoard: vi.fn() }));

// In a server render useActionState always returns the initial state. Here it is replaced
// with a state that has an error, and marked pending when the test asks for it.
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
    "create user",
    CreateUserForm,
    {
      error: "An account with that email already exists.",
      field: "email",
      values: { name: "Ana", email: "ana@example.com", role: "MEMBER" },
    },
  ],
  [
    "create token",
    CreateTokenForm,
    {
      error: "The name is required.",
      values: { name: "", scope: "read", expiry: "30" },
    },
  ],
  ["import board", ImportBoardForm, { error: "The file is not valid JSON." }],
];

describe("forms with an error message — re-announcing a repeated error", () => {
  it.each(forms)(
    "%s removes the role=alert message while submitting",
    (_name, Form, state) => {
      actionState.override = state;
      expect(renderToStaticMarkup(withI18n(createElement(Form)))).toContain('role="alert"');

      // If the node stayed mounted with the same text, a second identical error would
      // not change the DOM and the screen reader would not announce it.
      actionState.pending = true;
      expect(renderToStaticMarkup(withI18n(createElement(Form)))).not.toContain('role="alert"');
    },
  );

  it("create user does not point aria-describedby at a removed message", () => {
    // The email <input> tag, whatever the order of its attributes.
    const emailInput = (html: string) => html.match(/<input[^>]*name="email"[^>]*>/)?.[0];

    actionState.override = forms[0][2];
    expect(emailInput(renderToStaticMarkup(withI18n(createElement(CreateUserForm))))).toMatch(
      /aria-describedby="[^"]+"/,
    );

    actionState.pending = true;
    expect(emailInput(renderToStaticMarkup(withI18n(createElement(CreateUserForm))))).not.toMatch(
      /aria-describedby=/,
    );
  });
});
