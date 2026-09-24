import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { recordAudit } from "@/app/lib/audit";
import { resetDb, disconnect } from "./helpers";

// recordAudit es best-effort: si la escritura falla no debe romper la acción, pero
// tampoco perder el evento en silencio. El log no lleva detail, ip ni datos personales.

beforeEach(async () => {
  await resetDb();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await disconnect();
});

describe("recordAudit: fallo de escritura", () => {
  it.each([
    ["FK de userId inexistente", { userId: "no-existe", detail: "dato-privado-xyz" }],
    ["byte nulo en detail", { detail: "dato-privado-xyz\u0000" }],
  ])("%s: resuelve sin lanzar y lo registra sin el detail", async (_caso, extra) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      recordAudit({ action: "auth.login", ip: "192.0.2.10", ...extra }),
    ).resolves.toBeUndefined();

    expect(await prisma.auditLog.count()).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(spy.mock.calls[0]);
    expect(logged).toContain("auth.login");
    expect(logged).not.toContain("dato-privado-xyz");
    expect(logged).not.toContain("192.0.2.10");
    // Tampoco el userId: el error de FK de Postgres lo repite («Key (userId)=(…)»).
    expect(logged).not.toContain("no-existe");
  });

  it("si la escritura va bien no registra nada en el log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await recordAudit({ action: "auth.login", ip: null });
    expect(await prisma.auditLog.count()).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });
});
