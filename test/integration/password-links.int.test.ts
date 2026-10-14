import { describe, it, expect, beforeEach, afterAll, afterEach } from "vitest";
import { prisma } from "@/app/lib/prisma";
import {
  forgotPassword,
  resetPasswordWithToken,
} from "@/app/lib/actions/password";
import { createEmployeeAction } from "@/app/lib/actions/workspaces";
import { memoryOutbox } from "@/app/lib/mail/send";
import { verifyPassword } from "@/app/lib/auth";
import {
  resetDb,
  disconnect,
  seedUser,
  seedOrganization,
  seedApiToken,
  loginAs,
  en,
} from "./helpers";

// Password links sent by email (docs/email.md): "forgot your password" and the invitation
// of an employee's account. Mail goes to the in-memory outbox (ORGTABLE_SMTP_URL=memory://).

const MAIL_ENV = {
  ORGTABLE_SMTP_URL: "memory://",
  ORGTABLE_MAIL_FROM: "orgtable <no-reply@test.local>",
  ORGTABLE_PUBLIC_URL: "https://orgtable.test",
};

beforeEach(async () => {
  await resetDb();
  Object.assign(process.env, MAIL_ENV);
  memoryOutbox.length = 0;
  await prisma.instanceConfig.create({
    data: {
      id: "singleton",
      instanceName: "Test",
      setupCompletedAt: new Date(),
      registrationOpen: true,
      operatorName: "Operator",
      operatorEmail: "privacy@test.local",
    },
  });
});
afterEach(() => {
  for (const key of Object.keys(MAIL_ENV)) delete process.env[key];
});
afterAll(async () => {
  await disconnect();
});

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** Emails are sent without making the request wait: give them a moment to arrive. */
async function waitForMail(count: number): Promise<void> {
  for (let i = 0; i < 100 && memoryOutbox.length < count; i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** The token in the last email's link. */
function lastToken(): string {
  const mail = memoryOutbox.at(-1);
  const match = mail?.text.match(/reset-password\?token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error("no link in the last email");
  return match[1];
}

async function reset(
  token: string,
  password: string,
): Promise<string | { error?: string }> {
  try {
    return await resetPasswordWithToken(
      {},
      form({ token, password, confirm: password }),
    );
  } catch (e) {
    const digest = (e as { digest?: string }).digest;
    if (!digest?.startsWith("NEXT_REDIRECT")) throw e;
    return digest.split(";")[2];
  }
}

describe("forgot your password", () => {
  it("answers the same whether the address has an account or not", async () => {
    const unknown = await forgotPassword(
      {},
      form({ email: "nobody@test.local" }),
    );
    expect(unknown).toEqual({ sent: true, email: "nobody@test.local" });
    expect(memoryOutbox).toHaveLength(0);

    await seedUser({ email: "ana@test.local", name: "Ana" });
    const known = await forgotPassword({}, form({ email: "ANA@test.local" }));
    await waitForMail(1);
    expect(known).toEqual({ sent: true, email: "ANA@test.local" });
    expect(memoryOutbox).toHaveLength(1);
    expect(memoryOutbox[0]).toMatchObject({
      to: "ana@test.local",
      subject: en.emails.reset.subject,
    });
    expect(memoryOutbox[0].html).toContain(
      "https://orgtable.test/reset-password?token=",
    );
  });

  it("the link sets the password once and closes every session and API token", async () => {
    const user = await seedUser({ email: "ana@test.local" });
    await loginAs(user.id);
    await seedApiToken(user.id);
    await forgotPassword({}, form({ email: "ana@test.local" }));
    await waitForMail(1);
    const token = lastToken();
    // Only the hash is stored.
    expect(
      await prisma.accountToken.count({ where: { tokenHash: token } }),
    ).toBe(0);

    expect(await reset(token, "brand-new-password")).toBe(
      "/login?password=reset",
    );
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword("brand-new-password", row.passwordHash)).toBe(
      true,
    );
    expect(
      await prisma.session.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0);
    expect(await prisma.apiToken.count({ where: { userId: user.id } })).toBe(0);
    // The owner is told, in case it was not them.
    expect(memoryOutbox.at(-1)?.subject).toBe(en.emails.changed.subject);

    // A second use fails.
    expect(await reset(token, "another-password-1")).toEqual({
      error: en.auth.reset.invalid,
    });
  });

  it("an expired link does not work", async () => {
    await seedUser({ email: "ana@test.local" });
    await forgotPassword({}, form({ email: "ana@test.local" }));
    await waitForMail(1);
    const token = lastToken();
    await prisma.accountToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await reset(token, "brand-new-password")).toEqual({
      error: en.auth.reset.invalid,
    });
  });

  it("asking again replaces the previous link", async () => {
    await seedUser({ email: "ana@test.local" });
    await forgotPassword({}, form({ email: "ana@test.local" }));
    await waitForMail(1);
    const first = lastToken();
    await forgotPassword({}, form({ email: "ana@test.local" }));
    await waitForMail(2);
    expect(await reset(first, "brand-new-password")).toEqual({
      error: en.auth.reset.invalid,
    });
    expect(await reset(lastToken(), "brand-new-password")).toBe(
      "/login?password=reset",
    );
  });

  it("is rate limited per address", async () => {
    await seedUser({ email: "ana@test.local" });
    for (let i = 0; i < 3; i++)
      await forgotPassword({}, form({ email: "ana@test.local" }));
    const blocked = await forgotPassword({}, form({ email: "ana@test.local" }));
    expect(blocked.error).toBeTruthy();
    await waitForMail(3);
    expect(memoryOutbox).toHaveLength(3);
  });

  it("says email is not available when the instance has none", async () => {
    for (const key of Object.keys(MAIL_ENV)) delete process.env[key];
    const result = await forgotPassword({}, form({ email: "ana@test.local" }));
    expect(result.error).toBe(en.auth.forgot.unavailable);
  });

  it("escapes what people write into the email", async () => {
    await seedUser({
      email: "evil@test.local",
      name: '<img src=x onerror="alert(1)">',
    });
    await forgotPassword({}, form({ email: "evil@test.local" }));
    await waitForMail(1);
    const html = memoryOutbox[0].html;
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});

describe("employee invitations", () => {
  it("with email, the person chooses their own password from the invitation", async () => {
    const owner = await seedUser({ name: "Ana Owner" });
    const org = await seedOrganization(owner.id, "acme");
    await loginAs(owner.id);
    const state = await createEmployeeAction(
      {},
      form({
        workspaceId: org.id,
        name: "Dani",
        email: "dani@test.local",
        role: "MEMBER",
      }),
    );
    expect(state.message).toContain("dani@test.local");
    const mail = memoryOutbox.at(-1);
    expect(mail?.to).toBe("dani@test.local");
    expect(mail?.subject).toContain(org.slug === "acme" ? "Org acme" : "");
    expect(mail?.text).toContain("orgtable.test/acme");

    expect(await reset(lastToken(), "dani-own-password")).toBe(
      "/login?password=set",
    );
    const dani = await prisma.user.findUniqueOrThrow({
      where: { email: "dani@test.local" },
    });
    expect(await verifyPassword("dani-own-password", dani.passwordHash)).toBe(
      true,
    );
    // Setting the first password is not announced as a "password changed".
    expect(memoryOutbox.at(-1)?.subject).not.toBe(en.emails.changed.subject);
  });
});

describe("emailed links stop working when the password changes another way", () => {
  it("an organization setting the password by hand cancels the pending invitation", async () => {
    const owner = await seedUser({ name: "Owner" });
    const org = await seedOrganization(owner.id, "acme");
    await loginAs(owner.id);
    await createEmployeeAction(
      {},
      form({ workspaceId: org.id, name: "Typo", email: "typo@test.local", role: "MEMBER" }),
    );
    const token = lastToken();
    const typo = await prisma.user.findUniqueOrThrow({ where: { email: "typo@test.local" } });
    const { resetEmployeePassword } = await import("@/app/lib/services/workspaces");
    expect(
      await resetEmployeePassword({
        workspaceId: org.id,
        actorId: owner.id,
        userId: typo.id,
        password: "set-by-hand-1",
      }),
    ).toEqual({ ok: true });
    expect(await reset(token, "taken-over-1")).toEqual({ error: en.auth.reset.invalid });
  });
});

describe("invitation emails", () => {
  it("do not carry links or domains typed into names", async () => {
    const owner = await seedUser({ name: "Visit evil.example now" });
    const org = await prisma.workspace.create({
      data: {
        slug: "phish",
        name: "Win at https://evil.example/login",
        kind: "ORGANIZATION",
        members: { create: { userId: owner.id, role: "OWNER" } },
      },
    });
    await loginAs(owner.id);
    await createEmployeeAction(
      {},
      form({ workspaceId: org.id, name: "Go to www.evil.example", email: "victim@test.local", role: "MEMBER" }),
    );
    const mail = memoryOutbox.at(-1);
    expect(mail?.html).not.toContain("evil.example");
    expect(mail?.text).not.toContain("evil.example");
    expect(mail?.subject).not.toContain("evil.example");
  });
});
