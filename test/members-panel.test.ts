import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Las acciones de servidor importan Prisma; para renderizar el panel basta con
// sustituirlas (este test solo mira el HTML, no ejecuta ninguna acción).
vi.mock("@/app/lib/actions/members", () => ({
  addBoardMember: vi.fn(),
  updateBoardMemberRole: vi.fn(),
  removeBoardMember: vi.fn(),
}));

// En el render de servidor useActionState siempre devuelve el estado inicial. Para
// mirar el HTML tras un error (o mientras se envía) se sustituye cuando el test lo pide.
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
    createElement(MembersPanel, {
      boardId: "b1",
      members: [],
      canManage: true,
      onClose: () => {},
    }),
  );
}

// Opción marcada del <select name="role"> del formulario de invitar.
function selectedInviteRole(html: string): string | undefined {
  const select = html.match(/<select name="role"[^>]*>(.*?)<\/select>/);
  return select?.[1].match(/<option value="([A-Z]+)" selected="">/)?.[1];
}

describe("panel de miembros", () => {
  // OJO: no es la regresión del rol perdido tras un error. El HTML inicial ya salía con
  // VIEWER antes del arreglo; el fallo estaba en el cliente, donde React no aplica el
  // nuevo defaultValue a un <select> ya montado. El remontaje por key queda sin test
  // porque el proyecto no tiene jsdom. El caso siguiente (OWNER → Editor) sí falla con
  // el código anterior.
  it("con un error, el HTML inicial marca el rol devuelto en el selector de invitar", () => {
    actionState.override = {
      error: "No existe ninguna cuenta con ese email.",
      values: { email: "x@ejemplo.com", role: "VIEWER" },
    };
    expect(selectedInviteRole(render())).toBe("VIEWER");
  });

  it("si el rol devuelto no es asignable, el selector vuelve a Editor", () => {
    actionState.override = {
      error: "Rol no válido.",
      values: { email: "x@ejemplo.com", role: "OWNER" },
    };
    expect(selectedInviteRole(render())).toBe("EDITOR");
  });

  it("retira el aviso de error mientras se envía para que uno idéntico se reanuncie", () => {
    const error = "Ana ya es miembro de este tablero.";
    actionState.override = { error, values: { email: "ana@ejemplo.com", role: "EDITOR" } };
    expect(render()).toContain(`role="alert"`);

    actionState.pending = true;
    const html = render();
    expect(html).not.toContain(`role="alert"`);
    expect(html).not.toContain(error);
  });

  it("el fondo del diálogo solo se anima si no se pide movimiento reducido", () => {
    const html = render();
    expect(html).toContain("backdrop:motion-safe:animate-");
    expect(html).not.toContain("backdrop:animate-");
  });
});
