import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { login } from "@/app/lib/actions/auth";
import { __setHeaders } from "../stubs/next-headers";
import { cookies } from "next/headers";
import { resetDb, disconnect, seedUser, en, es } from "./helpers";

// Login (Server Action) against the real DB: per-IP and per-account limits, auditing
// without the typed email. TRUSTED_PROXY_HOPS is set per test with vi.stubEnv.

beforeEach(async () => {
  await resetDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await disconnect();
});

function form(email: string, password: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

// "Too many attempts. Try again in {seconds} seconds.": the number varies, so only the
// text before the placeholder is matched.
const TOO_MANY = new RegExp(
  `^${en.errors.auth.tooManyAttempts.other.split("{")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
);

describe("login: rate limit", () => {
  it("without trusted proxies, spoofing X-Forwarded-For does not avoid the per-account limit", async () => {
    // hops = 0 (the default): the header is ignored and only the per-email limit counts.
    for (let i = 0; i < 20; i++) {
      __setHeaders({ "x-forwarded-for": `203.0.113.${i}` });
      const r = await login({}, form("victim@test.local", "wrong"));
      expect(r.error).toBe(en.errors.auth.invalidCredentials);
    }
    __setHeaders({ "x-forwarded-for": "203.0.113.200" });
    const blocked = await login({}, form("victim@test.local", "wrong"));
    expect(blocked.error).toMatch(TOO_MANY);
  });

  it("with a trusted proxy, the IP is the one the proxy adds, not the one the client sends", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    // The client sends a different IP on each attempt; the proxy always appends the real one.
    for (let i = 0; i < 10; i++) {
      __setHeaders({ "x-forwarded-for": `198.51.100.${i}, 10.0.0.1` });
      const r = await login({}, form(`u${i}@test.local`, "wrong"));
      expect(r.error).toBe(en.errors.auth.invalidCredentials);
    }
    __setHeaders({ "x-forwarded-for": "198.51.100.99, 10.0.0.1" });
    const blocked = await login({}, form("other@test.local", "wrong"));
    expect(blocked.error).toMatch(TOO_MANY);
  });

  it("the per-account limit only counts failures: a successful login resets it", async () => {
    await seedUser({ email: "ana@test.local", password: "correct-123" });
    for (let i = 0; i < 19; i++) {
      await login({}, form("ana@test.local", "wrong"));
    }
    await expect(login({}, form("ana@test.local", "correct-123"))).rejects.toMatchObject({
      digest: expect.stringContaining("/boards"),
    });
    // After the success, 20 failures fit again before the block.
    for (let i = 0; i < 20; i++) {
      const r = await login({}, form("ANA@test.local", "wrong"));
      expect(r.error).toBe(en.errors.auth.invalidCredentials);
    }
    expect((await login({}, form("ana@test.local", "wrong"))).error).toMatch(TOO_MANY);
  });

  it("a sustained attack leaves a single auth.login_rate_limited row", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    __setHeaders({ "x-forwarded-for": "10.0.0.7" });
    for (let i = 0; i < 15; i++) {
      await login({}, form(`x${i}@test.local`, "wrong"));
    }
    expect(
      await prisma.auditLog.count({ where: { action: "auth.login_rate_limited" } }),
    ).toBe(1);
  });

  it("an invalid TRUSTED_PROXY_HOPS fails with a clear error", async () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "one");
    await expect(login({}, form("a@test.local", "wrong"))).rejects.toThrow(
      /TRUSTED_PROXY_HOPS/,
    );
  });
});

describe("login: failure auditing", () => {
  it("does not store the typed email; if the account exists it stores its userId", async () => {
    const u = await seedUser({ email: "real@test.local", password: "correct-123" });
    await login({}, form("ghost@test.local", "wrong"));
    await login({}, form("real@test.local", "wrong"));

    const rows = await prisma.auditLog.findMany({
      where: { action: "auth.login_failed" },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(JSON.stringify(row)).not.toContain("@test.local");
      expect(row.detail).toBeNull();
    }
    expect(rows.map((r) => r.userId).sort()).toEqual([null, u.id].sort());
  });
});

describe("login: values returned after an error", () => {
  it("returns the typed email and never the password", async () => {
    const state = await login({}, form("someone@test.local", "pasted-secret"));
    expect(state.error).toBe(en.errors.auth.invalidCredentials);
    expect(state.values).toEqual({ email: "someone@test.local" });
    expect(JSON.stringify(state)).not.toContain("pasted-secret");
  });

  it("also with a malformed email", async () => {
    const state = await login({}, form("not-an-email", "pasted-secret"));
    expect(state.error).toBe(en.errors.auth.checkCredentials);
    expect(state.values).toEqual({ email: "not-an-email" });
    expect(JSON.stringify(state)).not.toContain("pasted-secret");
  });
});

// The language of the answer comes from the `locale` cookie, then Accept-Language, then
// English (app/i18n/server.ts). The stub request has neither unless the test sets them.
describe("login: language of the answer", () => {
  it("answers in English when the request has no language preference", async () => {
    const state = await login({}, form("someone@test.local", "wrong"));
    expect(state.error).toBe(en.errors.auth.invalidCredentials);
  });

  it("answers in Spanish with Accept-Language: es", async () => {
    __setHeaders({ "accept-language": "es-ES,es;q=0.9,en;q=0.8" });
    const state = await login({}, form("someone@test.local", "wrong"));
    expect(state.error).toBe(es.errors.auth.invalidCredentials);
    expect(state.error).not.toBe(en.errors.auth.invalidCredentials);
  });

  it("answers in Spanish with the locale=es cookie", async () => {
    (await cookies()).set("locale", "es");
    const state = await login({}, form("not-an-email", "wrong"));
    expect(state.error).toBe(es.errors.auth.checkCredentials);
  });

  it("the cookie wins over Accept-Language", async () => {
    __setHeaders({ "accept-language": "es" });
    (await cookies()).set("locale", "en");
    const state = await login({}, form("someone@test.local", "wrong"));
    expect(state.error).toBe(en.errors.auth.invalidCredentials);
  });

  it("an unknown language in the cookie falls back to Accept-Language", async () => {
    __setHeaders({ "accept-language": "es" });
    (await cookies()).set("locale", "xx");
    const state = await login({}, form("someone@test.local", "wrong"));
    expect(state.error).toBe(es.errors.auth.invalidCredentials);
  });
});

describe("login: the account's language", () => {
  it("a successful login sets the locale cookie from User.locale", async () => {
    const user = await seedUser({ email: "ana@test.local", password: "correct-123" });
    await prisma.user.update({ where: { id: user.id }, data: { locale: "es" } });
    __setHeaders({ "accept-language": "en" });

    await expect(login({}, form("ana@test.local", "correct-123"))).rejects.toMatchObject({
      digest: expect.stringContaining("/boards"),
    });

    expect((await cookies()).get("locale")?.value).toBe("es");
  });

  it("an account without a language leaves the cookie alone", async () => {
    await seedUser({ email: "ana@test.local", password: "correct-123" });

    await expect(login({}, form("ana@test.local", "correct-123"))).rejects.toMatchObject({
      digest: expect.stringContaining("/boards"),
    });

    expect((await cookies()).get("locale")).toBeUndefined();
  });
});
