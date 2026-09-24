import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { GET as listBoards } from "@/app/api/v1/boards/route";
import { prisma } from "@/app/lib/prisma";
import { verifyPassword } from "@/app/lib/auth";
import { resetPasswordAndRevokeAccess } from "@/app/lib/services/users";
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
afterAll(async () => {
  await disconnect();
});

describe("restablecer contraseña retira todo el acceso (integración)", () => {
  it("revoca los tokens de API: el mismo Bearer pasa de 200 a 401", async () => {
    const victim = await seedUser();
    const other = await seedUser();
    const token = await seedApiToken(victim.id);
    const otherToken = await seedApiToken(other.id);

    const before = await listBoards(
      apiRequest("GET", "/api/v1/boards", { token }),
    );
    expect(before.status).toBe(200);

    const result = await resetPasswordAndRevokeAccess(
      victim.id,
      "nueva-contraseña-larga",
    );
    expect(result).toEqual({ ok: true, revokedTokens: 1 });

    const after = await listBoards(
      apiRequest("GET", "/api/v1/boards", { token }),
    );
    expect(after.status).toBe(401);
    expect(await prisma.apiToken.count({ where: { userId: victim.id } })).toBe(0);

    // Los tokens de otros usuarios no se tocan.
    const otherRes = await listBoards(
      apiRequest("GET", "/api/v1/boards", { token: otherToken }),
    );
    expect(otherRes.status).toBe(200);
  });

  it("cambia la contraseña y revoca las sesiones activas", async () => {
    const user = await seedUser({ password: "contraseña-antigua" });
    await prisma.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
    });

    await resetPasswordAndRevokeAccess(user.id, "contraseña-nueva");

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword("contraseña-nueva", row.passwordHash)).toBe(true);
    expect(
      await prisma.session.count({ where: { userId: user.id, revokedAt: null } }),
    ).toBe(0);
  });

  it("con un usuario inexistente no cambia nada", async () => {
    const other = await seedUser();
    await seedApiToken(other.id);
    const result = await resetPasswordAndRevokeAccess(
      "no-existe",
      "contraseña-nueva",
    );
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(await prisma.apiToken.count()).toBe(1);
  });
});
