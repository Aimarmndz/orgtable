import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { notify } from "@/app/lib/notifications";
import { resetDb, disconnect, seedUser } from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await disconnect();
});

describe("notify (integración)", () => {
  it("devuelve true y guarda la fila cuando la notificación se crea", async () => {
    const user = await seedUser();

    const ok = await notify({
      userId: user.id,
      type: "member.added",
      title: "Te han añadido",
    });

    expect(ok).toBe(true);
    expect(await prisma.notification.count({ where: { userId: user.id } })).toBe(1);
  });

  it("devuelve false y registra el fallo sin el texto si la inserción falla", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    // userId inexistente: la clave foránea hace fallar el insert.
    const ok = await notify({
      userId: "no-existe",
      type: "comment.added",
      title: "Título privado",
      body: "Cuerpo privado",
    });

    expect(ok).toBe(false);
    expect(await prisma.notification.count()).toBe(0);
    expect(logged).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(logged.mock.calls[0]);
    expect(serialized).toContain("no-existe");
    expect(serialized).not.toContain("privado");
  });
});
