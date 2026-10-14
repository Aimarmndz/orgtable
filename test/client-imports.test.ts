import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as limits from "@/app/lib/limits";
import * as validators from "@/app/lib/validators";

// "use client" components must not import zod or validators.ts: they would end up in the
// browser bundle just for a constant, and validators.ts uses Buffer, which does not exist
// there. The constants the UI needs live in app/lib/limits.ts. It only looks at direct
// imports: there is no bundler in the tests to follow transitive ones.

const APP_DIR = path.resolve(__dirname, "../app");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function isClientModule(source: string): boolean {
  return /^\s*["']use client["']/.test(source);
}

describe("imports of the client components", () => {
  const clientFiles = sourceFiles(APP_DIR).filter((file) =>
    isClientModule(readFileSync(file, "utf8")),
  );

  it("finds client components (the filter is not broken)", () => {
    expect(clientFiles.some((file) => file.endsWith("card-modal.tsx"))).toBe(true);
  });

  it("none of them imports zod or validators.ts", () => {
    const offenders = clientFiles.filter((file) =>
      /from\s+["'](zod|@\/app\/lib\/validators|[./]+\/(lib\/)?validators)["']/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(offenders.map((file) => path.relative(APP_DIR, file))).toEqual([]);
  });
});

describe("limits.ts", () => {
  it("has no imports, so it can be used on the client", () => {
    const source = readFileSync(path.join(APP_DIR, "lib/limits.ts"), "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
  });

  it("validators.ts re-exports the same description limit", () => {
    expect(validators.CARD_DESCRIPTION_MAX).toBe(limits.CARD_DESCRIPTION_MAX);
  });
});
