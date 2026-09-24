import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as limits from "@/app/lib/limits";
import * as validators from "@/app/lib/validators";

// Los componentes "use client" no deben importar zod ni validators.ts: entrarían en el
// bundle del navegador solo por una constante, y validators.ts usa Buffer, que allí no
// existe. Las constantes que necesita la UI viven en app/lib/limits.ts. Solo mira las
// importaciones directas: no hay bundler en los tests para seguir las transitivas.

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

describe("importaciones de los componentes de cliente", () => {
  const clientFiles = sourceFiles(APP_DIR).filter((file) =>
    isClientModule(readFileSync(file, "utf8")),
  );

  it("encuentra componentes de cliente (el filtro no está roto)", () => {
    expect(clientFiles.some((file) => file.endsWith("card-modal.tsx"))).toBe(true);
  });

  it("ninguno importa zod ni validators.ts", () => {
    const offenders = clientFiles.filter((file) =>
      /from\s+["'](zod|@\/app\/lib\/validators|[./]+\/(lib\/)?validators)["']/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(offenders.map((file) => path.relative(APP_DIR, file))).toEqual([]);
  });
});

describe("limits.ts", () => {
  it("no tiene importaciones, para poder usarse en el cliente", () => {
    const source = readFileSync(path.join(APP_DIR, "lib/limits.ts"), "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
  });

  it("validators.ts reexporta el mismo límite de descripción", () => {
    expect(validators.CARD_DESCRIPTION_MAX).toBe(limits.CARD_DESCRIPTION_MAX);
  });
});
