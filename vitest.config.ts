import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Unit test config (Vitest): no database and no network. What they cover and what is
// not pure logic is described in docs/testing.md, to keep it in a single place.
//
// Two aliases needed to run app modules outside Next:
//  - `server-only`: some modules import it as a "server only" marker; it does not apply
//    in tests, so it resolves to an empty stub.
//  - `@/…`: the same alias the app uses (tsconfig `@/* -> ./*`).
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
    // Integration tests (real DB) have their own config: vitest.integration.config.ts.
    exclude: ["test/integration/**", "node_modules/**"],
  },
});
