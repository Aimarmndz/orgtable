import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import {
  DUMMY_PASSWORD_HASH,
  SALT_ROUNDS,
  hashPassword,
  verifyPassword,
  verifyPasswordOrDummy,
} from "@/app/lib/auth";

// Hash ficticio del login: tiene que ser un hash bcrypt válido y del mismo coste que los
// reales. El literal anterior medía 59 caracteres, bcrypt.compare devolvía false al
// instante y un email inexistente respondía ~200 veces más rápido que uno existente.
describe("hash ficticio del login", () => {
  it("mide 60 caracteres y usa el mismo coste que hashPassword", () => {
    expect(DUMMY_PASSWORD_HASH).toHaveLength(60);
    expect(bcrypt.getRounds(DUMMY_PASSWORD_HASH)).toBe(SALT_ROUNDS);
  });

  it("no coincide con ninguna contraseña y no lanza", async () => {
    await expect(verifyPassword("x", DUMMY_PASSWORD_HASH)).resolves.toBe(false);
    await expect(verifyPasswordOrDummy("x", null)).resolves.toBe(false);
  });

  it("verifyPasswordOrDummy acepta la contraseña correcta de una cuenta real", async () => {
    const hash = await hashPassword("correcta");
    await expect(verifyPasswordOrDummy("correcta", hash)).resolves.toBe(true);
    await expect(verifyPasswordOrDummy("otra", hash)).resolves.toBe(false);
  });

  it("sin cuenta tarda del mismo orden que con cuenta (umbral holgado)", async () => {
    const hash = await hashPassword("correcta");
    const time = async (fn: () => Promise<unknown>) => {
      const start = performance.now();
      await fn();
      return performance.now() - start;
    };
    const real = await time(() => verifyPasswordOrDummy("mala", hash));
    const dummy = await time(() => verifyPasswordOrDummy("mala", null));
    expect(dummy).toBeGreaterThan(real * 0.5);
  });
});
