import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tests de INTEGRACIÓN: ejercen las rutas de la API y los servicios contra una base de
// datos PostgreSQL real (efímera). Se ejecutan con `npm run test:integration` y requieren
// DATABASE_URL apuntando a una base de datos de test (su nombre debe acabar en `_test`;
// los helpers lo verifican para no tocar nunca datos de dev/producción). Ver docs/testing.md.
//
// Alias para poder importar módulos de la app fuera de Next:
//  - server-only / next-cache / next-headers: stubs (no hay runtime de Next en los tests).
//  - @/…: el mismo alias que usa la app.
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "server-only",
        replacement: path.resolve(root, "test/stubs/server-only.ts"),
      },
      {
        find: "next/cache",
        replacement: path.resolve(root, "test/stubs/next-cache.ts"),
      },
      {
        find: "next/headers",
        replacement: path.resolve(root, "test/stubs/next-headers.ts"),
      },
      { find: /^@\//, replacement: `${root}/` },
    ],
  },
  test: {
    environment: "node",
    include: ["test/integration/**/*.int.test.ts"],
    // Una sola conexión a la BD: los tests comparten un PrismaClient y resetean entre
    // cada uno, así que no deben correr en paralelo entre archivos.
    fileParallelism: false,
    sequence: { concurrent: false },
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
