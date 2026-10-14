import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { withI18n } from "./helpers/i18n";

// The server actions import Prisma; replacing them is enough to render the panel (this
// test only looks at the HTML, it does not run any action).
// The visibility selector posts to this Server Action (Prisma); only its markup matters.
vi.mock("@/app/lib/actions/boards", () => ({ setBoardVisibility: vi.fn() }));
vi.mock("@/app/lib/actions/members", () => ({
  addBoardMember: vi.fn(),
  updateBoardMemberRole: vi.fn(),
  removeBoardMember: vi.fn(),
}));

// In a server render useActionState always returns the initial state. To look at the
// HTML after an error (or while submitting) it is replaced when the test asks for it.
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

const { MembersPanel } = await import("@/app/components/board/members-panel");

function render(): string {
  return renderToStaticMarkup(
    withI18n(
      createElement(MembersPanel, {
        boardId: "b1",
        members: [],
        canManage: true,
        visibility: null,
        onClose: () => {},
      }),
    ),
  );
}

// Selected option of the <select name="role"> in the invite form.
function selectedInviteRole(html: string): string | undefined {
  const select = html.match(/<select name="role"[^>]*>(.*?)<\/select>/);
  return select?.[1].match(/<option value="([A-Z]+)" selected="">/)?.[1];
}

describe("members panel", () => {
  // NOTE: this is not the regression of the role lost after an error. The initial HTML
  // already came out with VIEWER before the fix; the bug was on the client, where React
  // does not apply the new defaultValue to an already mounted <select>. The remount by
  // key is left untested because the project has no jsdom. The next case
  // (OWNER → Editor) does fail with the previous code.
  it("with an error, the initial HTML selects the returned role in the invite selector", () => {
    actionState.override = {
      error: "There is no account with that email.",
      values: { email: "x@example.com", role: "VIEWER" },
    };
    expect(selectedInviteRole(render())).toBe("VIEWER");
  });

  it("if the returned role is not assignable, the selector goes back to Editor", () => {
    actionState.override = {
      error: "Invalid role.",
      values: { email: "x@example.com", role: "OWNER" },
    };
    expect(selectedInviteRole(render())).toBe("EDITOR");
  });

  it("removes the error message while submitting so that an identical one is announced again", () => {
    const error = "Ana is already a member of this board.";
    actionState.override = { error, values: { email: "ana@example.com", role: "EDITOR" } };
    expect(render()).toContain(`role="alert"`);

    actionState.pending = true;
    const html = render();
    expect(html).not.toContain(`role="alert"`);
    expect(html).not.toContain(error);
  });

  it("the dialog backdrop is only animated if reduced motion is not requested", () => {
    const html = render();
    expect(html).toContain("backdrop:motion-safe:animate-");
    expect(html).not.toContain("backdrop:animate-");
  });
});
