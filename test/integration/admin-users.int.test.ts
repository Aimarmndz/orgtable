import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/app/lib/prisma";
import {
  updateUserRole,
  resetUserPassword,
  revokeUserSessions,
  deleteUser,
} from "@/app/lib/actions/admin";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedList,
  seedCard,
} from "./helpers";

// Las acciones autorizan con requireAdmin (cookie) y responden con redirect(). Sin
// runtime de Next se sustituyen: el admin es el usuario sembrado y redirect lanza un
// error con la URL, igual que el real interrumpe la acción.
const session = vi.hoisted(() => ({ adminId: "" }));
vi.mock("@/app/lib/dal", () => ({
  requireAdmin: async () => ({ id: session.adminId }),
}));
class RedirectError extends Error {}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** Ejecuta la acción y devuelve la URL a la que redirige. */
async function redirectOf(run: Promise<void>): Promise<string> {
  try {
    await run;
  } catch (err) {
    if (err instanceof RedirectError) return err.message;
    throw err;
  }
  throw new Error("La acción no redirigió");
}

beforeEach(async () => {
  await resetDb();
  session.adminId = (await seedUser({ role: "ADMIN" })).id;
});
afterAll(async () => {
  await disconnect();
});

describe("acciones de administración con un usuario inexistente (integración)", () => {
  const ghost = "usuario-que-no-existe";

  it("cambiar el rol avisa y no audita", async () => {
    const url = await redirectOf(
      updateUserRole(form({ userId: ghost, role: "ADMIN" })),
    );
    expect(url).toBe("/admin/users?error=not-found");
    expect(await prisma.auditLog.count({ where: { targetId: ghost } })).toBe(0);
  });

  it("restablecer la contraseña avisa y no audita", async () => {
    const url = await redirectOf(
      resetUserPassword(form({ userId: ghost, password: "contraseña-nueva" })),
    );
    expect(url).toBe("/admin/users?error=not-found");
    expect(await prisma.auditLog.count({ where: { targetId: ghost } })).toBe(0);
  });

  it("cerrar sesiones avisa y no audita", async () => {
    const url = await redirectOf(revokeUserSessions(form({ userId: ghost })));
    expect(url).toBe("/admin/users?error=not-found");
    expect(await prisma.auditLog.count({ where: { targetId: ghost } })).toBe(0);
  });

  it("borrar avisa y no audita", async () => {
    const url = await redirectOf(deleteUser(form({ userId: ghost })));
    expect(url).toBe("/admin/users?error=not-found");
    expect(await prisma.auditLog.count({ where: { targetId: ghost } })).toBe(0);
  });

  it("sin userId en el formulario responde «invalid»", async () => {
    const url = await redirectOf(revokeUserSessions(form({})));
    expect(url).toBe("/admin/users?error=invalid");
  });
});

describe("acciones de administración con un usuario real (integración)", () => {
  it("cerrar sesiones de un usuario sin sesiones es válido y se audita", async () => {
    const user = await seedUser();
    const url = await redirectOf(revokeUserSessions(form({ userId: user.id })));
    expect(url).toBe("/admin/users?ok=revoked");
    expect(
      await prisma.auditLog.count({
        where: { targetId: user.id, action: "user.sessions_revoked" },
      }),
    ).toBe(1);
  });

  it("cambiar el rol lo guarda y lo audita", async () => {
    const user = await seedUser();
    const url = await redirectOf(
      updateUserRole(form({ userId: user.id, role: "ADMIN" })),
    );
    expect(url).toBe("/admin/users?ok=role");
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.role).toBe("ADMIN");
    expect(await prisma.auditLog.count({ where: { targetId: user.id } })).toBe(1);
  });

  it("borra un usuario sin tableros propios y lo audita", async () => {
    const user = await seedUser();
    const url = await redirectOf(deleteUser(form({ userId: user.id })));
    expect(url).toBe("/admin/users?ok=delete");
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { targetId: user.id, action: "user.deleted" },
      }),
    ).toBe(1);
  });

  it("no borra a un propietario de tableros: sus adjuntos siguen en BD (nada queda huérfano)", async () => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    const list = await seedList(board.id);
    const card = await seedCard(list.id);
    await prisma.attachment.create({
      data: {
        cardId: card.id,
        filename: "informe.pdf",
        storedName: "00000000-0000-0000-0000-000000000000.pdf",
        mimeType: "application/pdf",
        size: 10,
      },
    });

    const url = await redirectOf(deleteUser(form({ userId: owner.id })));
    expect(url).toBe("/admin/users?error=owns-boards");
    expect(await prisma.user.count({ where: { id: owner.id } })).toBe(1);
    expect(await prisma.attachment.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { targetId: owner.id } })).toBe(0);
  });
});
