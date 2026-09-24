import { describe, it, expect, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildPoolConfig } from "@/app/lib/prisma";

// Configuración del pool de pg y singleton de PrismaClient (app/lib/prisma.ts).

describe("pool de conexiones de Prisma", () => {
  it("fija un timeout de conexión (pg espera para siempre por defecto)", () => {
    const config = buildPoolConfig("postgresql://u:p@localhost:5432/x_test");
    expect(config.connectionTimeoutMillis).toBe(5_000);
    expect(config.idleTimeoutMillis).toBe(30_000);
  });

  // Reproduce el cuelgue: con el pool agotado, la consulta siguiente debe fallar por
  // timeout en vez de quedarse esperando. Se usa un pool de 1 y 200 ms para no tardar.
  it("con el pool agotado, una consulta falla por timeout en vez de colgarse", async () => {
    const adapter = new PrismaPg({
      ...buildPoolConfig(process.env.DATABASE_URL),
      max: 1,
      connectionTimeoutMillis: 200,
    });
    const client = new PrismaClient({ adapter });
    try {
      await client.$transaction(async (tx) => {
        // La transacción interactiva ocupa la única conexión del pool.
        await tx.$queryRaw`SELECT 1`;
        await expect(client.$queryRaw`SELECT 1`).rejects.toThrow(/timeout/i);
      });
    } finally {
      await client.$disconnect();
    }
  });
});

describe("singleton de PrismaClient", () => {
  // Turbopack evalúa el módulo una vez por capa; en producción, sin globalThis, cada
  // evaluación abría su propio pool.
  it("en producción reutiliza el mismo cliente entre evaluaciones del módulo", async () => {
    const g = globalThis as unknown as { prisma: PrismaClient | undefined };
    const previous = g.prisma;
    vi.stubEnv("NODE_ENV", "production");
    try {
      g.prisma = undefined;
      vi.resetModules();
      const first = (await import("@/app/lib/prisma")).prisma;
      vi.resetModules();
      const second = (await import("@/app/lib/prisma")).prisma;
      expect(second).toBe(first);
      await first.$disconnect();
    } finally {
      vi.unstubAllEnvs();
      g.prisma = previous;
    }
  });
});
