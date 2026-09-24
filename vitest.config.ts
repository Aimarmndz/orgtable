import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Configuración de los tests unitarios (Vitest): sin base de datos ni red. Qué cubren
// y qué no es lógica pura está en docs/testing.md, para no mantenerlo en dos sitios.
//
// Dos alias necesarios para ejecutar módulos de la app fuera de Next:
//  - `server-only`: algunos módulos lo importan como marca de "solo servidor"; en los
//    tests no aplica, así que se resuelve a un stub vacío.
//  - `@/…`: el mismo alias que usa la app (tsconfig `@/* -> ./*`).
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "server-only",
        replacement: path.resolve(root, "test/stubs/server-only.ts"),
      },
      { find: /^@\//, replacement: `${root}/` },
    ],
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Los tests de integración (DB real) tienen su propia config: vitest.integration.config.ts.
    exclude: ["test/integration/**", "node_modules/**"],
  },
});
