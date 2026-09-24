import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { authenticateApiToken } from "@/app/lib/api/auth";
import {
  resetDb,
  disconnect,
  seedUser,
  seedApiToken,
  apiRequest,
} from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await disconnect();
});

describe("authenticateApiToken — marca de último uso (integración)", () => {
  it("actualiza lastUsedAt en cada petición autenticada", async () => {
    const user = await seedUser();
    const token = await seedApiToken(user.id);

    const auth = await authenticateApiToken(
      apiRequest("GET", "/api/v1/boards", { token }),
    );
    expect(auth).toEqual({ userId: user.id, scope: "full" });
    const row = await prisma.apiToken.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(row.lastUsedAt).not.toBeNull();
  });

  it("si falla la escritura, autentica igual y lo registra sin el token", async () => {
    const user = await seedUser();
    const token = await seedApiToken(user.id);
    const row = await prisma.apiToken.findFirstOrThrow({
      where: { userId: user.id },
    });
    vi.spyOn(prisma.apiToken, "update").mockRejectedValueOnce(
      new Error("BD caída"),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const auth = await authenticateApiToken(
      apiRequest("GET", "/api/v1/boards", { token }),
    );

    expect(auth).toEqual({ userId: user.id, scope: "full" });
    expect(errorSpy).toHaveBeenCalledWith(
      "[api-auth] no se pudo actualizar lastUsedAt",
      { tokenId: row.id, error: "BD caída" },
    );
    // Ni el token en claro ni su hash aparecen en el registro.
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(row.tokenHash);
  });
});
