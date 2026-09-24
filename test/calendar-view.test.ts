import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { ListDTO } from "@/app/lib/types";

// La acción de servidor importa Prisma; aquí solo se mira el HTML inicial.
vi.mock("@/app/lib/actions/cards", () => ({ setCardDueDate: vi.fn() }));

const { CalendarView, preventSpaceActivation } = await import(
  "@/app/components/board/calendar-view"
);

function keyUp(code: string) {
  const preventDefault = vi.fn();
  preventSpaceActivation({ code, preventDefault });
  return preventDefault;
}

describe("CalendarView — pastillas", () => {
  it("cancela el keyup de Espacio para que coger o soltar no abra la tarjeta", () => {
    expect(keyUp("Space")).toHaveBeenCalledOnce();
  });

  it("no toca Intro ni otras teclas (Intro sigue abriendo la tarjeta)", () => {
    expect(keyUp("Enter")).not.toHaveBeenCalled();
    expect(keyUp("ArrowRight")).not.toHaveBeenCalled();
  });
});

describe("CalendarView — render de servidor", () => {
  // Una tarjeta con fecha en el mes actual, para que aparezca en la rejilla.
  const now = new Date();
  const due = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-15T00:00:00.000Z`;
  const lists: ListDTO[] = [
    {
      id: "l1",
      title: "Pendiente",
      position: "a0",
      cards: [
        {
          id: "c1",
          title: "Revisar contrato",
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

  it("renderiza sin tocar document (el portal del DragOverlay solo se monta en el navegador)", () => {
    const html = renderToString(
      createElement(CalendarView, { lists, onOpenCard: () => {}, canEdit: true }),
    );
    expect(html).toContain("Revisar contrato");
    expect(html).toContain('aria-roledescription="tarjeta"');
  });
});
