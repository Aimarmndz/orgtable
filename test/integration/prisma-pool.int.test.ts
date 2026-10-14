import { describe, it, expect, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { buildPoolConfig } from "@/app/lib/prisma";

// pg pool configuration and the PrismaClient singleton (app/lib/prisma.ts).

describe("Prisma connection pool", () => {
  it("sets a connection timeout (pg waits forever by default)", () => {
    const config = buildPoolConfig("postgresql://u:p@localhost:5432/x_test");
    expect(config.connectionTimeoutMillis).toBe(5_000);
    expect(config.idleTimeoutMillis).toBe(10_000);
  });

  // Checks the wiring: the client the module exports is created with buildPoolConfig and
  // with onPoolError. If someone goes back to `new PrismaPg({ connectionString })`, it fails.
  it("the exported client uses buildPoolConfig and logs only the error message", async () => {
    const g = globalThis as unknown as { prisma: PrismaClient | undefined };
    const previous = g.prisma;
    const calls: ConstructorParameters<typeof PrismaPg>[] = [];
    vi.doMock("@prisma/adapter-pg", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@prisma/adapter-pg")>();
      class RecordingPrismaPg extends actual.PrismaPg {
        constructor(...args: ConstructorParameters<typeof PrismaPg>) {
          super(...args);
          calls.push(args);
        }
      }
      return { ...actual, PrismaPg: RecordingPrismaPg };
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      g.prisma = undefined;
      vi.resetModules();
      const { prisma } = await import("@/app/lib/prisma");
      expect(calls).toHaveLength(1);
      const [config, options] = calls[0];
      expect(config).toEqual(buildPoolConfig(process.env.DATABASE_URL));

      // The message is logged, not the Error object (which could carry more data).
      options?.onPoolError?.(new Error("connection closed"));
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]).toEqual([expect.any(String), "connection closed"]);
      await prisma.$disconnect();
    } finally {
      errorSpy.mockRestore();
      vi.doUnmock("@prisma/adapter-pg");
      vi.resetModules();
      g.prisma = previous;
    }
  });

  // Reproduces the hang with the pg configuration: with the pool exhausted, the next query
  // fails with a timeout instead of waiting. A pool of 1 and 200 ms are used so it does not
  // take 5 s; that the app uses that timeout is checked by the previous test.
  it("with the pool exhausted, a query fails with a timeout instead of hanging", async () => {
    const adapter = new PrismaPg({
      ...buildPoolConfig(process.env.DATABASE_URL),
      max: 1,
      connectionTimeoutMillis: 200,
    });
    const client = new PrismaClient({ adapter });
    try {
      await client.$transaction(async (tx) => {
        // The interactive transaction takes the pool's only connection.
        await tx.$queryRaw`SELECT 1`;
        await expect(client.$queryRaw`SELECT 1`).rejects.toThrow(/timeout/i);
      });
    } finally {
      await client.$disconnect();
    }
  });
});

describe("PrismaClient singleton", () => {
  // Turbopack evaluates the module once per layer; in production, without globalThis, each
  // evaluation opened its own pool.
  it("in production it reuses the same client across module evaluations", async () => {
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
