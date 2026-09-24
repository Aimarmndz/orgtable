import { describe, it, expect, vi, afterAll, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";

// El directorio de subida se fija al importar storage.ts, así que la variable se define
// antes de cualquier import (vi.hoisted se ejecuta primero).
const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "orgtable-storage-"));
  process.env.ORGTABLE_UPLOAD_DIR = dir;
  return dir;
});

import {
  saveAttachmentFile,
  deleteAttachmentFile,
} from "@/app/lib/storage";

afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(() => {
  rmSync(uploadDir, { recursive: true, force: true });
  delete process.env.ORGTABLE_UPLOAD_DIR;
});

describe("storage: deleteAttachmentFile", () => {
  it("borra el fichero guardado", async () => {
    const { storedName } = await saveAttachmentFile(
      new File(["hola"], "nota.txt", { type: "text/plain" }),
    );
    expect(existsSync(path.join(uploadDir, storedName))).toBe(true);
    await deleteAttachmentFile(storedName);
    expect(existsSync(path.join(uploadDir, storedName))).toBe(false);
  });

  it("un fichero que ya no existe (ENOENT) no registra nada", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await deleteAttachmentFile("no-existe.txt");
    expect(spy).not.toHaveBeenCalled();
  });

  // Regresión: el catch vacío se tragaba cualquier error. Un directorio con el nombre del
  // adjunto hace fallar unlink con EISDIR (Linux) o EPERM (macOS), no con ENOENT.
  it("otros errores de unlink se registran sin lanzar", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mkdirSync(path.join(uploadDir, "es-un-directorio"));
    await expect(deleteAttachmentFile("es-un-directorio")).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
    const [, detail] = spy.mock.calls[0] as [string, { storedName: string; code: string }];
    expect(detail.storedName).toBe("es-un-directorio");
    expect(["EISDIR", "EPERM"]).toContain(detail.code);
  });
});
