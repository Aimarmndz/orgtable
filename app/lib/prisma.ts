import "server-only";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";

// Singleton de PrismaClient guardado en globalThis también en producción. En desarrollo,
// el HMR recarga los módulos y abriría un pool nuevo en cada recarga. En producción,
// Turbopack evalúa este módulo una vez por capa (route handlers por un lado, RSC/SSR por
// otro): sin globalThis habría dos pools y el doble de conexiones a Postgres. bus.ts y
// rate-limit.ts usan el mismo patrón.
//
// En Prisma 7 la conexión directa a la base de datos se hace a través de un driver
// adapter (aquí @prisma/adapter-pg sobre node-postgres). DATABASE_URL se lee de
// process.env en runtime (inyectada por docker-compose o por el .env en dev), nunca
// se hornea en el build.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Configuración del pool de node-postgres. Con los valores por defecto de pg
 * (`connectionTimeoutMillis: 0`) una petición que no encuentra conexión libre espera
 * para siempre; Prisma 7 ya no aplica el `connect_timeout` de 5 s que traía Prisma 6.
 * Se exporta para que test/integration/prisma-pool.int.test.ts la ejercite.
 */
export function buildPoolConfig(connectionString: string | undefined): PoolConfig {
  return {
    connectionString,
    // Esperar una conexión libre del pool (o abrir una nueva) falla a los 5 s.
    connectionTimeoutMillis: 5_000,
    // Las conexiones inactivas se cierran a los 10 s: el valor por defecto de pg-pool,
    // explícito para que el test lo vigile y no cambie sin querer.
    idleTimeoutMillis: 10_000,
  };
}

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
  const adapter = new PrismaPg(buildPoolConfig(url), {
    // El adapter ya escucha el evento 'error' del pool (no tumba el proceso), pero sin
    // este manejador el fallo de una conexión inactiva (Postgres reiniciado, red cortada)
    // solo iba a su log de depuración. Se registra solo el mensaje: nunca la cadena de
    // conexión, que lleva la contraseña.
    onPoolError: (err) =>
      console.error("[prisma] error en una conexión inactiva del pool de pg:", err.message),
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

globalForPrisma.prisma = prisma;
