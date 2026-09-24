import { describe, it, expect } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { CardItem } from "@/app/components/board/card-item";
import { BoardPermsProvider } from "@/app/components/board/board-perms";
import type { BoardRole } from "@/app/lib/roles";
import type { CardDTO } from "@/app/lib/types";

// Render de servidor (sin DOM): comprueba el HTML que llega al navegador antes de
// hidratar, que es donde estaban los fallos de accesibilidad y de fechas.
const card: CardDTO = {
  id: "c1",
  title: "Revisar contrato",
  position: "a0",
  description: null,
  dueDate: "2020-01-02T00:00:00.000Z", // vencida hace tiempo
  labels: [],
  checklists: [],
  attachments: [],
  assignees: [],
  comments: [],
};

function render(role: BoardRole, props: { overlay?: boolean } = {}): string {
  return renderToString(
    createElement(
      BoardPermsProvider,
      // `children` va como tercer argumento; el tipo de props lo exige igualmente.
      { role } as ComponentProps<typeof BoardPermsProvider>,
      createElement(CardItem, { card, listId: "l1", ...props }),
    ),
  );
}

describe("CardItem", () => {
  it("es enfocable y se anuncia como botón aunque no se pueda arrastrar (Lector)", () => {
    const html = render("VIEWER");
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Revisar contrato"');
  });

  it("con permisos de edición mantiene el foco y describe el rol en español", () => {
    const html = render("EDITOR");
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-roledescription="tarjeta"');
  });

  it("la copia flotante del arrastre no recibe foco", () => {
    expect(render("EDITOR", { overlay: true })).toContain('tabindex="-1"');
  });

  it("no marca «vencida» en el HTML del servidor (depende del día del navegador)", () => {
    const html = render("VIEWER");
    expect(html).not.toContain("text-danger");
    expect(html).toContain("2 ene");
  });
});
