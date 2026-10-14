import { describe, it, expect } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { CardItem } from "@/app/components/board/card-item";
import { BoardPermsProvider } from "@/app/components/board/board-perms";
import type { BoardRole } from "@/app/lib/roles";
import type { CardDTO } from "@/app/lib/types";
import { withI18n } from "./helpers/i18n";

// Server render (no DOM): checks the HTML that reaches the browser before hydration,
// which is where the accessibility and date bugs were.
const card: CardDTO = {
  id: "c1",
  title: "Review contract",
  position: "a0",
  description: null,
  dueDate: "2020-01-02T00:00:00.000Z", // overdue long ago
  labels: [],
  checklists: [],
  attachments: [],
  assignees: [],
  comments: [],
};

function render(role: BoardRole, props: { overlay?: boolean } = {}): string {
  return renderToString(
    withI18n(
      createElement(
        BoardPermsProvider,
        // `children` goes as the third argument; the props type requires it anyway.
        { role } as ComponentProps<typeof BoardPermsProvider>,
        createElement(CardItem, { card, listId: "l1", ...props }),
      ),
    ),
  );
}

describe("CardItem", () => {
  it("is focusable and announced as a button even if it cannot be dragged (Viewer)", () => {
    const html = render("VIEWER");
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
  });

  it("takes its accessible name from the content, not from an aria-label with only the title", () => {
    const html = render("VIEWER");
    // The first element is the card itself: its opening tag has no aria-label, so the
    // screen reader reads title, due date, subtasks...
    const openingTag = html.slice(0, html.indexOf(">") + 1);
    expect(openingTag).toContain('role="button"');
    expect(openingTag).not.toContain("aria-label");
    expect(html).toContain("Review contract");
    expect(html).toContain("Jan 2");
  });

  it("with edit permissions it keeps focus and describes the role in the interface language", () => {
    const html = render("EDITOR");
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-roledescription="card"');
  });

  it("the floating drag copy does not receive focus", () => {
    expect(render("EDITOR", { overlay: true })).toContain('tabindex="-1"');
  });

  it("does not mark \"overdue\" in the server HTML (it depends on the browser's day)", () => {
    const html = render("VIEWER");
    expect(html).not.toContain("text-danger");
    expect(html).toContain("Jan 2");
  });
});
