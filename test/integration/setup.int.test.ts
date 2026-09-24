import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { completeSetup } from "@/app/lib/actions/setup";
import { completeInstanceSetup } from "@/app/lib/services/setup";
import { hashPassword } from "@/app/lib/auth";
import { resetDb, disconnect, seedUser } from "./helpers";

// Espía sobre hashPassword sin cambiar su comportamiento: permite comprobar que la acción
// no gasta bcrypt cuando el setup ya está hecho.
vi.mock("@/app/lib/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/app/lib/auth")>();
  return { ...original, hashPassword: vi.fn(original.hashPassword) };
});

beforeEach(async () => {
  await resetDb();
  vi.mocked(hashPassword).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await disconnect();
});

function setupForm(fields: Partial<Record<string, string>> = {}): FormData {
  const fd = new FormData();
  const values = {
    instanceName: "Mi equipo",
    name: "Admin",
    email: "admin@test.local",
    password: "contraseña-larga",
    ...fields,
  };
  for (const [k, v] of Object.entries(values)) if (v !== undefined) fd.set(k, v);
  return fd;
}

describe("completeInstanceSetup: dos envíos simultáneos", () => {
  it("solo crea un administrador; el otro recibe ALREADY_SETUP", async () => {
    const passwordHash = "hash-no-usado-en-login";
    for (let i = 0; i < 20; i++) {
      await prisma.instanceConfig.deleteMany();
      await prisma.user.deleteMany();

      const results = await Promise.allSettled([
        completeInstanceSetup({ instanceName: "A", name: "A", email: `a${i}@test.local`, passwordHash }),
        completeInstanceSetup({ instanceName: "B", name: "B", email: `b${i}@test.local`, passwordHash }),
      ]);

      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
      const outcomes = results.map((r) => (r.status === "fulfilled" ? r.value : null));
      expect(outcomes.filter((o) => o?.ok)).toHaveLength(1);
      expect(outcomes.filter((o) => o && !o.ok && o.reason === "ALREADY_SETUP")).toHaveLength(1);
      expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(1);
    }
  });
});

describe("completeSetup (Server Action)", () => {
  it("con el setup ya hecho redirige a /login sin validar ni gastar bcrypt", async () => {
    await prisma.instanceConfig.create({
      data: { id: "singleton", instanceName: "Hecha", setupCompletedAt: new Date() },
    });

    await expect(completeSetup({}, setupForm())).rejects.toMatchObject({
      digest: expect.stringContaining(";/login;"),
    });
    expect(hashPassword).not.toHaveBeenCalled();
    expect(await prisma.user.count()).toBe(0);
  });

  it("si la BD rechaza el alta devuelve el error, lo registra sin el email y no marca el setup", async () => {
    await seedUser({ email: "ya-existe@test.local" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const state = await completeSetup({}, setupForm({ email: "ya-existe@test.local" }));

    expect(state.error).toBe("No se pudo completar la configuración. Inténtalo de nuevo.");
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(spy.mock.calls[0]);
    expect(logged).toContain("P2002");
    expect(logged).not.toContain("ya-existe@test.local");
    const config = await prisma.instanceConfig.findUnique({ where: { id: "singleton" } });
    expect(config?.setupCompletedAt ?? null).toBeNull();
  });

  it("con datos no válidos devuelve lo tecleado salvo la contraseña", async () => {
    const state = await completeSetup(
      {},
      setupForm({ email: "no-es-email", password: "secreto-pegado" }),
    );
    expect(state.error).toBeTruthy();
    expect(state.values).toEqual({
      instanceName: "Mi equipo",
      name: "Admin",
      email: "no-es-email",
    });
    expect(JSON.stringify(state)).not.toContain("secreto-pegado");
  });

  it("con datos correctos crea el admin, abre sesión y redirige a /boards", async () => {
    await expect(completeSetup({}, setupForm())).rejects.toMatchObject({
      digest: expect.stringContaining(";/boards;"),
    });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });
    expect(admin.role).toBe("ADMIN");
    expect(await prisma.session.count({ where: { userId: admin.id } })).toBe(1);
  });
});
