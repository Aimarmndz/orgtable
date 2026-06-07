import "server-only";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Singleton de PrismaClient. En desarrollo, Next recarga los módulos en caliente
// (HMR) y crearía una nueva conexión en cada recarga, agotando el pool de Postgres.
// Guardarlo en globalThis evita la fuga. En producción se crea una sola vez.
//
// En Prisma 7 la conexión directa a la base de datos se hace a través de un driver
// adapter (aquí @prisma/adapter-pg sobre node-postgres). DATABASE_URL se lee de
// process.env en runtime (inyectada por docker-compose o por el .env en dev), nunca
// se hornea en el build.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const url = process.env.DATABASE_URL;
  // Falla rápido y claro si falta DATABASE_URL: sin ella, el adapter caería en silencio a
  // los defaults de libpq (PGHOST/localhost…), conectando a una BD no deseada. No se valida
  // durante `next build` (NEXT_PHASE), que no necesita la BD.
  if (!url && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error(
      "DATABASE_URL no está configurado. Define la cadena de conexión a PostgreSQL.",
    );
  }
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
