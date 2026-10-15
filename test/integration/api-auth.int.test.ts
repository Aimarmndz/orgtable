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

describe("authenticateApiToken — last-used mark (integration)", () => {
  it("updates lastUsedAt on every authenticated request", async () => {
    const user = await seedUser();
    const token = await seedApiToken(user.id);

    const auth = await authenticateApiToken(
      apiRequest("GET", "/api/v1/boards", { token }),
    );
    expect(auth).toEqual({ userId: user.id, scope: "full", workspaceId: null });
    const row = await prisma.apiToken.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(row.lastUsedAt).not.toBeNull();
  });

  it("if the write fails, it still authenticates and logs it without the token", async () => {
    const user = await seedUser();
    const token = await seedApiToken(user.id);
    const row = await prisma.apiToken.findFirstOrThrow({
      where: { userId: user.id },
    });
    vi.spyOn(prisma.apiToken, "update").mockRejectedValueOnce(
      new Error("DB down"),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const auth = await authenticateApiToken(
      apiRequest("GET", "/api/v1/boards", { token }),
    );

    expect(auth).toEqual({ userId: user.id, scope: "full", workspaceId: null });
    expect(errorSpy).toHaveBeenCalledWith(
      "[api-auth] could not update lastUsedAt",
      { tokenId: row.id, error: "DB down" },
    );
    // Neither the plain token nor its hash appear in the log.
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(row.tokenHash);
  });
});
