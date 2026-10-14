import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { completeSetup } from "@/app/lib/actions/setup";
import { completeInstanceSetup } from "@/app/lib/services/setup";
import { hashPassword } from "@/app/lib/auth";
import { resetDb, disconnect, seedUser, en } from "./helpers";

// Spy on hashPassword without changing its behaviour: lets us check that the action does
// not spend bcrypt time when the setup is already done.
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
    instanceName: "My team",
    name: "Admin",
    email: "admin@test.local",
    password: "contraseña-larga",
    ...fields,
  };
  for (const [k, v] of Object.entries(values)) if (v !== undefined) fd.set(k, v);
  return fd;
}

describe("completeInstanceSetup: two simultaneous submissions", () => {
  it("creates only one administrator; the other gets ALREADY_SETUP", async () => {
    const passwordHash = "hash-not-used-for-login";
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
  it("with the setup already done it redirects to /login without validating or spending bcrypt", async () => {
    await prisma.instanceConfig.create({
      data: { id: "singleton", instanceName: "Done", setupCompletedAt: new Date() },
    });

    await expect(completeSetup({}, setupForm())).rejects.toMatchObject({
      digest: expect.stringContaining(";/login;"),
    });
    expect(hashPassword).not.toHaveBeenCalled();
    expect(await prisma.user.count()).toBe(0);
  });

  it("if the DB rejects the insert it returns the error, logs it without the email and does not mark the setup", async () => {
    await seedUser({ email: "already-exists@test.local" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const state = await completeSetup({}, setupForm({ email: "already-exists@test.local" }));

    expect(state.error).toBe(en.errors.setup.failed);
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(spy.mock.calls[0]);
    expect(logged).toContain("P2002");
    expect(logged).not.toContain("already-exists@test.local");
    const config = await prisma.instanceConfig.findUnique({ where: { id: "singleton" } });
    expect(config?.setupCompletedAt ?? null).toBeNull();
  });

  it("with invalid data it returns what was typed except the password", async () => {
    const state = await completeSetup(
      {},
      setupForm({ email: "not-an-email", password: "pasted-secret" }),
    );
    expect(state.error).toBeTruthy();
    expect(state.values).toEqual({
      instanceName: "My team",
      name: "Admin",
      email: "not-an-email",
    });
    expect(JSON.stringify(state)).not.toContain("pasted-secret");
  });

  it("with valid data it creates the admin, signs in and redirects to /boards", async () => {
    await expect(completeSetup({}, setupForm())).rejects.toMatchObject({
      digest: expect.stringContaining(";/boards;"),
    });
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });
    expect(admin.role).toBe("ADMIN");
    expect(await prisma.session.count({ where: { userId: admin.id } })).toBe(1);
  });
});
