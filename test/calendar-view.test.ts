import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { ListDTO } from "@/app/lib/types";
import { withI18n } from "./helpers/i18n";

// The server action imports Prisma; here only the initial HTML is checked.
vi.mock("@/app/lib/actions/cards", () => ({ setCardDueDate: vi.fn() }));

const { CalendarView, preventSpaceActivation } = await import(
  "@/app/components/board/calendar-view"
);

function keyUp(code: string) {
  const preventDefault = vi.fn();
  preventSpaceActivation({ code, preventDefault });
  return preventDefault;
}

describe("CalendarView — pills", () => {
  it("cancels the Space keyup so that picking up or dropping does not open the card", () => {
    expect(keyUp("Space")).toHaveBeenCalledOnce();
  });

  it("leaves Enter and other keys alone (Enter still opens the card)", () => {
    expect(keyUp("Enter")).not.toHaveBeenCalled();
    expect(keyUp("ArrowRight")).not.toHaveBeenCalled();
  });
});

describe("CalendarView — server render", () => {
  // A card dated in the current month, so that it shows up in the grid.
  const now = new Date();
  const due = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15T00:00:00.000Z`;
  const lists: ListDTO[] = [
    {
      id: "l1",
      title: "To do",
      position: "a0",
      cards: [
        {
          id: "c1",
          title: "Review contract",
          position: "a0",
          description: null,
          dueDate: due,
          labels: [],
          checklists: [],
          attachments: [],
          assignees: [],
          comments: [],
        },
      ],
    },
  ];

  it("renders without touching document (the DragOverlay portal is only mounted in the browser)", () => {
    const html = renderToString(
      withI18n(createElement(CalendarView, { lists, onOpenCard: () => {}, canEdit: true })),
    );
    expect(html).toContain("Review contract");
    expect(html).toContain('aria-roledescription="card"');
  });
});
