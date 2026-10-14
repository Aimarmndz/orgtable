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

describe("resetting a password removes all access (integration)", () => {
  it("revokes the API tokens: the same Bearer goes from 200 to 401", async () => {
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
      "new-long-password",
    );
    expect(result).toEqual({ ok: true, revokedTokens: 1 });

    const after = await listBoards(
      apiRequest("GET", "/api/v1/boards", { token }),
    );
    expect(after.status).toBe(401);
    expect(await prisma.apiToken.count({ where: { userId: victim.id } })).toBe(0);

    // Other users' tokens are left alone.
    const otherRes = await listBoards(
      apiRequest("GET", "/api/v1/boards", { token: otherToken }),
    );
    expect(otherRes.status).toBe(200);
  });

  it("changes the password and revokes the active sessions", async () => {
    const user = await seedUser({ password: "old-password" });
    await prisma.session.create({
      data: { userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
    });

    await resetPasswordAndRevokeAccess(user.id, "new-password");

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword("new-password", row.passwordHash)).toBe(true);
    expect(
      await prisma.session.count({ where: { userId: user.id, revokedAt: null } }),
    ).toBe(0);
  });

  it("changes nothing for a user that does not exist", async () => {
    const other = await seedUser();
    await seedApiToken(other.id);
    const result = await resetPasswordAndRevokeAccess(
      "does-not-exist",
      "new-password",
    );
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(await prisma.apiToken.count()).toBe(1);
  });
});
