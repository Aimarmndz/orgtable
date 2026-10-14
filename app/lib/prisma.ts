import "server-only";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";

// PrismaClient singleton kept in globalThis, in production too. In development, HMR
// reloads modules and would open a new pool on every reload. In production, Turbopack
// evaluates this module once per layer (route handlers on one side, RSC/SSR on the
// other): without globalThis there would be two pools and twice the Postgres
// connections. bus.ts and rate-limit.ts use the same pattern.
//
// In Prisma 7 the direct database connection goes through a driver adapter (here
// @prisma/adapter-pg over node-postgres). DATABASE_URL is read from process.env at runtime
// (injected by docker-compose or by .env in dev), never baked into the build.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * node-postgres pool configuration. With pg's defaults (`connectionTimeoutMillis: 0`) a
 * request that finds no free connection waits forever; Prisma 7 no longer applies the 5 s
 * `connect_timeout` that Prisma 6 had. Exported so that
 * test/integration/prisma-pool.int.test.ts can exercise it.
 */
export function buildPoolConfig(connectionString: string | undefined): PoolConfig {
  return {
    connectionString,
    // Waiting for a free pool connection (or opening a new one) fails after 5 s.
    connectionTimeoutMillis: 5_000,
    // Idle connections close after 10 s: pg-pool's default, made explicit so the test
    // guards it against accidental changes.
    idleTimeoutMillis: 10_000,
  };
}

function createPrismaClient() {
  const url = process.env.DATABASE_URL;
  // Fails fast and clearly when DATABASE_URL is missing: without it, the adapter would
  // silently fall back to libpq defaults (PGHOST/localhost…) and connect to an unintended
  // database. Not checked during `next build` (NEXT_PHASE), which needs no database.
  if (!url && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error(
      "DATABASE_URL is not set. Define the PostgreSQL connection string.",
    );
  }
  const adapter = new PrismaPg(buildPoolConfig(url), {
    // The adapter already listens to the pool's 'error' event (it does not crash the
    // process), but without this handler a failing idle connection (Postgres restarted,
    // network cut) only reached its debug log. Only the message is logged: never the
    // connection string, which holds the password.
    onPoolError: (err) =>
      console.error("[prisma] error on an idle pg pool connection:", err.message),
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

globalForPrisma.prisma = prisma;
