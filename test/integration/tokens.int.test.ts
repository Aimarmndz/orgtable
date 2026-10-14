import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { createApiToken } from "@/app/lib/actions/tokens";
import { resetDb, disconnect, seedUser, loginAs, en } from "./helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

function tokenForm(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(async () => {
  await resetDb();
  await loginAs((await seedUser()).id);
});
afterAll(async () => {
  await disconnect();
});

describe("createApiToken — permission and expiry validation (integration)", () => {
  it("rejects an unknown scope without creating anything", async () => {
    const state = await createApiToken(
      {},
      tokenForm({ name: "script", scope: "readonly", expiry: "30" }),
    );
    expect(state.error).toBe(en.errors.tokens.invalidScope);
    expect(state.token).toBeUndefined();
    expect(await prisma.apiToken.count()).toBe(0);
  });

  it("rejects an unknown expiry without creating anything", async () => {
    const state = await createApiToken(
      {},
      tokenForm({ name: "script", scope: "read", expiry: "7" }),
    );
    expect(state.error).toBe(en.errors.tokens.invalidExpiry);
    expect(await prisma.apiToken.count()).toBe(0);
  });

  it("after an error it returns what was chosen so the form does not lose it", async () => {
    const state = await createApiToken(
      {},
      tokenForm({ name: "script", scope: "read", expiry: "7" }),
    );
    expect(state.values).toEqual({ name: "script", scope: "read", expiry: "7" });
  });

  it("rejects missing permissions or expiry (it used to fall back to write access without expiry)", async () => {
    const state = await createApiToken({}, tokenForm({ name: "script" }));
    expect(state.error).toBeDefined();
    expect(await prisma.apiToken.count()).toBe(0);
  });

  it("stores the read scope and a 30-day expiry", async () => {
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

  it("“Never” (0) creates a token without expiry", async () => {
    await createApiToken(
      {},
      tokenForm({ name: "script", scope: "full", expiry: "0" }),
    );
    const row = await prisma.apiToken.findFirstOrThrow();
    expect(row.expiresAt).toBeNull();
  });
});
