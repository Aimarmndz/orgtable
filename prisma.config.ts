import path from "node:path";
import { defineConfig, env } from "prisma/config";

// Prisma 7 does not load `.env` automatically. It is loaded by hand with Node's native
// API (available since 20.12), without depending on `dotenv`. In CI/production, where
// there is no `.env` (variables are injected through the environment), the try/catch
// skips it.
try {
  process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch {
  // No .env: the variables already come from the environment (e.g. docker-compose).
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
  },
  // URL used by the Migrate CLI (migrate dev/deploy). The app runtime uses its own
  // adapter in app/lib/prisma.ts.
  datasource: {
    url: env("DATABASE_URL"),
  },
});
