import { describe, it, expect, vi } from "vitest";
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

  // Antes se medían los tiempos de una sola llamada de cada tipo: una pausa del GC o un
  // runner de CI cargado bastaba para que fallara sin cambios de código. Lo que importa es
  // que el camino sin cuenta haga el mismo trabajo de bcrypt contra el hash ficticio; que
  // ese hash cueste lo mismo que uno real ya lo comprueba el primer test.
  it("sin cuenta compara contra el hash ficticio con bcrypt", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    try {
      await verifyPasswordOrDummy("mala", null);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("mala", DUMMY_PASSWORD_HASH);
    } finally {
      spy.mockRestore();
    }
  });
});
