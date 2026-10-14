import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { withI18n } from "./helpers/i18n";

// The server actions import Prisma; replacing them is enough to render the forms (this
// test only looks at the initial HTML, it does not run any action).
vi.mock("@/app/lib/actions/admin", () => ({ createUser: vi.fn() }));
vi.mock("@/app/lib/actions/tokens", () => ({ createApiToken: vi.fn() }));

// In a server render useActionState always returns the initial state. To look at the
// HTML with a freshly created token it is replaced, only when the test asks for it.
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

describe("admin and settings forms — accessibility", () => {
  it("create user mounts the role=status region before the message arrives", () => {
    const html = renderToStaticMarkup(withI18n(createElement(CreateUserForm)));
    expect(html).toContain('role="status"');
  });

  it("create token mounts the role=status region and the select keeps its initial value", () => {
    const html = renderToStaticMarkup(withI18n(createElement(CreateTokenForm)));
    expect(html).toContain('role="status"');
    expect(html).toMatch(/<option value="full" selected="">/);
  });

  it("with a created token, the role=status region contains neither the token nor the button", () => {
    const token = "ot_secret-test-token";
    actionState.override = { token, name: "CI" };
    const html = renderToStaticMarkup(withI18n(createElement(CreateTokenForm)));
    const status = html.match(/<div role="status">(.*?)<\/div>/);
    expect(status).not.toBeNull();
    expect(status![1]).toContain("Token “CI” created");
    expect(status![1]).not.toContain(token);
    expect(status![1]).not.toContain("<button");
    // The token is still visible outside the live region.
    expect(html).toContain(`>${token}</code>`);
  });
});
