import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { register } from "@/app/lib/actions/register";
import { saveInstanceSettings } from "@/app/lib/actions/instance";
import { isRegistrationOpen } from "@/app/lib/services/instance";
import { verifySession } from "@/app/lib/dal";
import robots from "@/app/robots";
import { __setHeaders } from "../stubs/next-headers";
import { cookies } from "next/headers";
import { resetDb, disconnect, seedUser, loginAs, en, es } from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

const LEGAL = { operatorName: "Test operator", operatorEmail: "privacy@test.local" };

async function seedInstance(data: Partial<{ registrationOpen: boolean; operatorName: string; operatorEmail: string }> = {}) {
  await prisma.instanceConfig.create({
    data: { id: "singleton", instanceName: "Test", setupCompletedAt: new Date(), ...data },
  });
}

function form(fields: Record<string, string | undefined>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) fd.set(k, v);
  return fd;
}

function registerForm(fields: Record<string, string | undefined> = {}): FormData {
  return form({
    name: "New Person",
    email: "New@Test.local",
    password: "contraseña-larga",
    acceptTerms: "on",
    ...fields,
  });
}

/** Runs register and returns the redirect URL (or fails if it does not redirect). */
async function registerRedirect(fd: FormData): Promise<string> {
  try {
    const state = await register({}, fd);
    throw new Error(`register did not redirect: ${JSON.stringify(state)}`);
  } catch (e) {
    const digest = (e as { digest?: string }).digest;
    if (!digest?.startsWith("NEXT_REDIRECT")) throw e;
    return digest.split(";")[2];
  }
}

describe("open registration (register)", () => {
  it("creates a MEMBER account, stores the acceptance, signs in and audits", async () => {
    await seedInstance({ registrationOpen: true, ...LEGAL });
    const before = Date.now();

    expect(await registerRedirect(registerForm())).toBe("/boards");

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "new@test.local" } });
    expect(user.role).toBe("MEMBER");
    expect(user.termsAcceptedAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(user.passwordHash).not.toContain("contraseña");
    expect((await verifySession())?.userId).toBe(user.id);
    expect(
      await prisma.auditLog.count({ where: { action: "auth.registered", userId: user.id } }),
    ).toBe(1);
  });

  it("creates nothing with registration closed", async () => {
    await seedInstance({ registrationOpen: false, ...LEGAL });
    const state = await register({}, registerForm());
    expect(state.error).toBe(en.errors.register.closed);
    expect(await prisma.user.count()).toBe(0);
  });

  // Defence in depth: if someone empties the legal details directly in the DB, registration
  // closes by itself instead of accepting sign-ups without a complete privacy policy.
  it("open but without an operator or contact counts as closed", async () => {
    await seedInstance({ registrationOpen: true });
    expect(await isRegistrationOpen()).toBe(false);
    const state = await register({}, registerForm());
    expect(state.error).toBe(en.errors.register.closed);
    expect(await prisma.user.count()).toBe(0);
  });

  it("does not create the account without accepting the policy and the terms", async () => {
    await seedInstance({ registrationOpen: true, ...LEGAL });
    const state = await register({}, registerForm({ acceptTerms: undefined }));
    expect(state.field).toBe("acceptTerms");
    expect(state.error).toBe(en.errors.validation.acceptTermsRequired);
    expect(await prisma.user.count()).toBe(0);
  });

  it("rejects a filled-in honeypot field without giving hints", async () => {
    await seedInstance({ registrationOpen: true, ...LEGAL });
    const state = await register({}, registerForm({ website: "https://spam.example" }));
    expect(state.error).toBe(en.errors.register.failed);
    expect(await prisma.user.count()).toBe(0);
  });

  it("an email already registered (with different capitalisation) does not create another account", async () => {
    await seedInstance({ registrationOpen: true, ...LEGAL });
    await seedUser({ email: "new@test.local" });
    const state = await register({}, registerForm());
    expect(state).toMatchObject({ field: "email", values: { email: "New@Test.local" } });
    expect(await prisma.user.count()).toBe(1);
  });

  it("two simultaneous sign-ups with the same email: one account and no 500 error", async () => {
    await seedInstance({ registrationOpen: true, ...LEGAL });
    const results = await Promise.allSettled([
      registerRedirect(registerForm()),
      registerRedirect(registerForm()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toContain(en.errors.register.emailTaken);
    expect(await prisma.user.count()).toBe(1);
  });

  it("limits sign-ups per IP when there is a trusted proxy", async () => {
    await seedInstance({ registrationOpen: true, ...LEGAL });
    process.env.TRUSTED_PROXY_HOPS = "1";
    __setHeaders({ "x-forwarded-for": "203.0.113.7" });
    try {
      for (let i = 0; i < 5; i++) {
        await registerRedirect(registerForm({ email: `p${i}@test.local` }));
      }
      const state = await register({}, registerForm({ email: "p6@test.local" }));
      expect(state.error).toMatch(
        new RegExp(`^${en.errors.register.rateLimited.other.split("{")[0]}`),
      );
      expect(await prisma.user.count()).toBe(5);
      expect(
        await prisma.auditLog.count({ where: { action: "auth.register_rate_limited" } }),
      ).toBe(1);
    } finally {
      delete process.env.TRUSTED_PROXY_HOPS;
    }
  });
});

describe("instance settings (saveInstanceSettings)", () => {
  function settingsForm(fields: Record<string, string> = {}): FormData {
    return form({
      instanceName: "Test",
      registrationOpen: "closed",
      operatorName: "",
      operatorEmail: "",
      operatorLegalId: "",
      operatorAddress: "",
      hostingDescription: "",
      backupRetentionDays: "",
      ...fields,
    });
  }

  it("does not allow opening registration without an operator and contact", async () => {
    await seedInstance();
    const admin = await seedUser({ role: "ADMIN" });
    await loginAs(admin.id);

    const state = await saveInstanceSettings({}, settingsForm({ registrationOpen: "open" }));
    expect(state.field).toBe("registrationOpen");
    expect(state.values?.registrationOpen).toBe("open");
    expect((await prisma.instanceConfig.findUniqueOrThrow({ where: { id: "singleton" } })).registrationOpen).toBe(false);
  });

  it("saves the legal details, opens registration and dates the update", async () => {
    await seedInstance();
    const admin = await seedUser({ role: "ADMIN" });
    await loginAs(admin.id);

    const state = await saveInstanceSettings(
      {},
      settingsForm({
        registrationOpen: "open",
        operatorName: "  Operator  ",
        operatorEmail: "privacy@test.local",
        backupRetentionDays: "14",
      }),
    );
    expect(state.message).toBe(en.errors.instance.saved);

    const config = await prisma.instanceConfig.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(config).toMatchObject({
      registrationOpen: true,
      operatorName: "Operator",
      operatorEmail: "privacy@test.local",
      operatorLegalId: null,
      backupRetentionDays: 14,
    });
    expect(config.legalUpdatedAt).toBeInstanceOf(Date);
    expect(await isRegistrationOpen()).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "instance.updated" } })).toBe(1);
  });

  it("rejects an invalid contact email", async () => {
    await seedInstance();
    const admin = await seedUser({ role: "ADMIN" });
    await loginAs(admin.id);
    const state = await saveInstanceSettings({}, settingsForm({ operatorEmail: "not-an-email" }));
    expect(state.field).toBe("operatorEmail");
  });

  it("a MEMBER cannot change the settings", async () => {
    await seedInstance();
    const member = await seedUser();
    await loginAs(member.id);
    await expect(
      saveInstanceSettings({}, settingsForm({ registrationOpen: "open", ...LEGAL })),
    ).rejects.toMatchObject({ digest: expect.stringContaining(";/boards;") });
    expect((await prisma.instanceConfig.findUniqueOrThrow({ where: { id: "singleton" } })).operatorName).toBeNull();
  });
});

describe("robots.txt", () => {
  // Open, the landing at the root ("/$": the root alone, not every path) is public too.
  it("closed, it allows indexing nothing; open, only the public pages", async () => {
    await seedInstance({ registrationOpen: false, ...LEGAL });
    expect((await robots()).rules).toEqual({ userAgent: "*", disallow: "/" });

    await prisma.instanceConfig.update({ where: { id: "singleton" }, data: { registrationOpen: true } });
    expect((await robots()).rules).toEqual({
      userAgent: "*",
      allow: ["/$", "/login", "/register", "/legal/"],
      disallow: "/",
    });
  });
});

// The account keeps the language the person signed up in, so that notifications for them
// are written in it (User.locale).
describe("registration language", () => {
  it("stores the request's language as the account's language", async () => {
    await seedInstance({ registrationOpen: true, ...LEGAL });
    (await cookies()).set("locale", "es");

    expect(await registerRedirect(registerForm())).toBe("/boards");

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "new@test.local" } });
    expect(user.locale).toBe("es");
  });

  it("without a language preference the account is stored in English", async () => {
    await seedInstance({ registrationOpen: true, ...LEGAL });

    await registerRedirect(registerForm());

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "new@test.local" } });
    expect(user.locale).toBe("en");
  });

  it("errors follow the request's language", async () => {
    await seedInstance({ registrationOpen: false, ...LEGAL });
    __setHeaders({ "accept-language": "es-ES,es;q=0.9" });

    const state = await register({}, registerForm());

    expect(state.error).toBe(es.errors.register.closed);
  });
});
