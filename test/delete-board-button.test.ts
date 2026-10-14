import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { withI18n } from "./helpers/i18n";

// The real action drags in Prisma and the session; here only what is rendered matters.
vi.mock("@/app/lib/actions/boards", () => ({ deleteBoard: vi.fn() }));

const { DeleteBoardButton } = await import(
  "@/app/(app)/boards/delete-board-button"
);

describe("DeleteBoardButton", () => {
  it("the first click cannot submit anything: no form and no submit button", () => {
    const html = renderToStaticMarkup(
      withI18n(
        createElement(DeleteBoardButton, {
          boardId: "b1",
          title: "Plan",
          className: "x",
        }),
      ),
    );
    // It used to be <form action={deleteBoard}><button>✕</button></form>: one click (or a
    // tap on the corner on touch screens) deleted the board in cascade.
    expect(html).not.toContain("<form");
    expect(html).toContain('type="button"');
    expect(html).not.toContain('type="submit"');
    expect(html).toContain('aria-label="Delete board Plan"');
  });
});
