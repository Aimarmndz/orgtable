import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { createUserAccount } from "@/app/lib/services/users";
import { verifyPassword } from "@/app/lib/auth";
import { resetDb, disconnect } from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

describe("user creation (integration)", () => {
  it("creates an account with the password hashed (never in plain text) and the email normalised", async () => {
    const r = await createUserAccount({
      name: "Ada Lovelace",
      email: "  Ada@Example.com  ",
      password: "very-long-secret",
      role: "MEMBER",
    });
    expect(r.ok).toBe(true);

    const user = await prisma.user.findUnique({
      where: { email: "ada@example.com" },
    });
    expect(user).not.toBeNull();
    expect(user!.email).toBe("ada@example.com"); // trimmed + lower case
    expect(user!.passwordHash).not.toBe("very-long-secret"); // never in plain text
    expect(user!.passwordHash.startsWith("$2")).toBe(true); // bcrypt
    expect(await verifyPassword("very-long-secret", user!.passwordHash)).toBe(
      true,
    );
    expect(await verifyPassword("wrong", user!.passwordHash)).toBe(false);
  });

  it("rejects a duplicate email (case-insensitive)", async () => {
    await createUserAccount({
      name: "A",
      email: "dup@test.local",
      password: "x".repeat(10),
      role: "MEMBER",
    });
    const r2 = await createUserAccount({
      name: "B",
      email: "DUP@test.local",
      password: "y".repeat(10),
      role: "ADMIN",
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toBe("email_taken");
    expect(await prisma.user.count()).toBe(1);
  });

  it("honours the assigned global role", async () => {
    await createUserAccount({
      name: "Boss",
      email: "admin@test.local",
      password: "z".repeat(10),
      role: "ADMIN",
    });
    const u = await prisma.user.findUnique({
      where: { email: "admin@test.local" },
    });
    expect(u!.role).toBe("ADMIN");
  });
});
