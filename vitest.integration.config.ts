import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

// INTEGRATION tests: they exercise the API routes and services against a real
// (ephemeral) PostgreSQL database. Run with `pnpm test:integration`; they require
// DATABASE_URL pointing at a test database (its name must end in `_test`; the helpers
// check it so dev/production data is never touched). See docs/testing.md.
//
// Aliases to import app modules outside Next:
//  - server-only / next-cache / next-headers: stubs (there is no Next runtime in tests).
//  - @/…: the same alias the app uses.
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
    // Fixed time zone: date logic (reminders) uses local time; UTC makes it
    // deterministic on any machine and in CI.
    // SESSION_SECRET: a FIXED, test-only key so createSession/verifySession work with
    // the cookie stub (loginAs). It protects nothing real.
    env: { TZ: "UTC", SESSION_SECRET: "test-only-session-secret-0123456789" },
    include: ["test/integration/**/*.int.test.ts"],
    // A single DB connection: tests share one PrismaClient and reset between each test,
    // so files must not run in parallel.
    fileParallelism: false,
    sequence: { concurrent: false },
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
