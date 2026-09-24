import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { createApiToken } from "@/app/lib/actions/tokens";
import { resetDb, disconnect, seedUser } from "./helpers";

// La acción autoriza con requireUser (cookie de sesión). Aquí no hay runtime de Next,
// así que se sustituye el DAL por el usuario sembrado en cada test.
const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/app/lib/dal", () => ({
  requireUser: async () => ({ id: session.userId }),
}));

const DAY_MS = 24 * 60 * 60 * 1000;

function tokenForm(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(async () => {
  await resetDb();
  session.userId = (await seedUser()).id;
});
afterAll(async () => {
  await disconnect();
});

describe("createApiToken — validación de permisos y caducidad (integración)", () => {
  it("rechaza un scope desconocido sin crear nada", async () => {
    const state = await createApiToken(
      {},
      tokenForm({ name: "script", scope: "readonly", expiry: "30" }),
    );
    expect(state.error).toBe("Permisos no válidos.");
    expect(state.token).toBeUndefined();
    expect(await prisma.apiToken.count()).toBe(0);
  });

  it("rechaza una caducidad desconocida sin crear nada", async () => {
    const state = await createApiToken(
      {},
      tokenForm({ name: "script", scope: "read", expiry: "7" }),
    );
    expect(state.error).toBe("Caducidad no válida.");
    expect(await prisma.apiToken.count()).toBe(0);
  });

  it("rechaza que falten permisos o caducidad (antes caía a escritura sin caducidad)", async () => {
    const state = await createApiToken({}, tokenForm({ name: "script" }));
    expect(state.error).toBeDefined();
    expect(await prisma.apiToken.count()).toBe(0);
  });

  it("guarda scope read y caducidad a 30 días", async () => {
    const before = Date.now();
    const state = await createApiToken(
      {},
      tokenForm({ name: "script", scope: "read", expiry: "30" }),
    );
    expect(state.error).toBeUndefined();
    expect(state.token).toMatch(/.+/);

    const row = await prisma.apiToken.findFirstOrThrow();
    expect(row.scope).toBe("read");
    expect(row.name).toBe("script");
    const expires = row.expiresAt!.getTime();
    expect(expires).toBeGreaterThanOrEqual(before + 30 * DAY_MS);
    expect(expires).toBeLessThanOrEqual(Date.now() + 30 * DAY_MS);
  });

  it("«Nunca» (0) crea un token sin caducidad", async () => {
    await createApiToken(
      {},
      tokenForm({ name: "script", scope: "full", expiry: "0" }),
    );
    const row = await prisma.apiToken.findFirstOrThrow();
    expect(row.expiresAt).toBeNull();
  });
});
