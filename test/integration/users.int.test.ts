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

describe("creación de usuarios (integración)", () => {
  it("crea una cuenta con la contraseña hasheada (nunca en claro) y email normalizado", async () => {
    const r = await createUserAccount({
      name: "Ada Lovelace",
      email: "  Ada@Example.com  ",
      password: "secreto-muy-largo",
      role: "MEMBER",
    });
    expect(r.ok).toBe(true);

    const user = await prisma.user.findUnique({
      where: { email: "ada@example.com" },
    });
    expect(user).not.toBeNull();
    expect(user!.email).toBe("ada@example.com"); // recortado + minúsculas
    expect(user!.passwordHash).not.toBe("secreto-muy-largo"); // nunca en claro
    expect(user!.passwordHash.startsWith("$2")).toBe(true); // bcrypt
    expect(await verifyPassword("secreto-muy-largo", user!.passwordHash)).toBe(
      true,
    );
    expect(await verifyPassword("incorrecta", user!.passwordHash)).toBe(false);
  });

  it("rechaza un email duplicado (insensible a mayúsculas)", async () => {
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

  it("respeta el rol global asignado", async () => {
    await createUserAccount({
      name: "Jefa",
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
