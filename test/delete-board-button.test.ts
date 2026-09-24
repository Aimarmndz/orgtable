import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// La acción real arrastra Prisma y la sesión; aquí solo importa qué se pinta.
vi.mock("@/app/lib/actions/boards", () => ({ deleteBoard: vi.fn() }));

const { DeleteBoardButton } = await import(
  "@/app/(app)/boards/delete-board-button"
);

describe("DeleteBoardButton", () => {
  it("el primer clic no puede enviar nada: sin formulario ni botón submit", () => {
    const html = renderToStaticMarkup(
      createElement(DeleteBoardButton, {
        boardId: "b1",
        title: "Plan",
        className: "x",
      }),
    );
    // Antes era <form action={deleteBoard}><button>✕</button></form>: un clic (o un
    // toque en la esquina en táctil) borraba el tablero en cascada.
    expect(html).not.toContain("<form");
    expect(html).toContain('type="button"');
    expect(html).not.toContain('type="submit"');
    expect(html).toContain('aria-label="Borrar tablero Plan"');
  });
});
