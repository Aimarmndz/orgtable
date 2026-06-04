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
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
