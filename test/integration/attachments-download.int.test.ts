import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { chmod, rm } from "node:fs/promises";
import path from "node:path";

// Directorio de subida temporal (storage.ts lo fija al importarse).
const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "orgtable-download-"));
  process.env.ORGTABLE_UPLOAD_DIR = dir;
  return dir;
});

import { prisma } from "@/app/lib/prisma";
import { saveAttachmentFile } from "@/app/lib/storage";
import { GET as downloadAttachment } from "@/app/api/attachments/[id]/route";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedList,
  seedCard,
  ctx,
  loginAs,
} from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(uploadDir, { recursive: true, force: true });
  delete process.env.ORGTABLE_UPLOAD_DIR;
  await disconnect();
});

async function seedAttachment() {
  const owner = await seedUser();
  const board = await seedBoard(owner.id);
  const card = await seedCard((await seedList(board.id)).id);
  const { storedName, size } = await saveAttachmentFile(
    new File(["hola"], "nota.txt", { type: "text/plain" }),
  );
  const attachment = await prisma.attachment.create({
    data: { cardId: card.id, filename: "nota.txt", storedName, mimeType: "text/plain", size },
  });
  return { owner, attachment, filePath: path.join(uploadDir, storedName) };
}

function get(id: string) {
  return downloadAttachment(new Request(`http://test/api/attachments/${id}`), ctx({ id }));
}

describe("descarga de adjuntos", () => {
  it("un miembro descarga el fichero (200)", async () => {
    const { owner, attachment } = await seedAttachment();
    await loginAs(owner.id);

    const res = await get(attachment.id);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hola");
  });

  // Regresión: un id ajeno daba 403 y uno inexistente 404, lo que revelaba qué ids existen.
  it("un no miembro recibe el mismo 404 que un id inexistente", async () => {
    const { attachment } = await seedAttachment();
    const stranger = await seedUser();
    await loginAs(stranger.id);

    const foreign = await get(attachment.id);
    const missing = await get("cminexistente000000000000");
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.text()).toBe(await missing.text());
  });

  it("sin sesión da 401", async () => {
    const { attachment } = await seedAttachment();
    expect((await get(attachment.id)).status).toBe(401);
  });

  it("una fila sin fichero en disco da 404 y se registra como aviso", async () => {
    const { owner, attachment, filePath } = await seedAttachment();
    await rm(filePath);
    await loginAs(owner.id);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await get(attachment.id);
    expect(res.status).toBe(404);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  // Como root, chmod 000 no impide leer: el caso no se puede reproducir y se salta.
  it.skipIf(process.getuid?.() === 0)(
    "un error de lectura que no es ENOENT da 500 y se registra",
    async () => {
      const { owner, attachment, filePath } = await seedAttachment();
      await chmod(filePath, 0o000);
      await loginAs(owner.id);
      const error = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        const res = await get(attachment.id);
        expect(res.status).toBe(500);
        expect(error).toHaveBeenCalledTimes(1);
      } finally {
        error.mockRestore();
        await chmod(filePath, 0o644);
      }
    },
  );
});
