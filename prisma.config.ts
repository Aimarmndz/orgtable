import path from "node:path";
import { defineConfig, env } from "prisma/config";

// Prisma 7 no carga `.env` automáticamente. Lo cargamos a mano con la API nativa de
// Node (disponible en 20.12+), sin depender de `dotenv`. En CI/producción donde no
// existe `.env` (las variables se inyectan por el entorno) el try/catch lo ignora.
try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  // .env ausente: las variables ya vienen del entorno (p. ej. docker-compose).
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  // URL usada por el CLI de Migrate (migrate dev/deploy). El runtime de la app usa
  // su propio adapter en app/lib/prisma.ts.
  datasource: {
    url: env("DATABASE_URL"),
  },
});
