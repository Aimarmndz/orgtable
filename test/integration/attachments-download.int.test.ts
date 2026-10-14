import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { chmod, rm } from "node:fs/promises";
import path from "node:path";

// Temporary upload directory (storage.ts reads it when imported).
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
  await rm(uploadDir, { recursive: true, force: true });
  delete process.env.ORGTABLE_UPLOAD_DIR;
  await disconnect();
});

async function seedAttachment() {
  const owner = await seedUser();
  const board = await seedBoard(owner.id);
  const card = await seedCard((await seedList(board.id)).id);
  const { storedName, size } = await saveAttachmentFile(
    new File(["hello"], "note.txt", { type: "text/plain" }),
  );
  const attachment = await prisma.attachment.create({
    data: { cardId: card.id, filename: "note.txt", storedName, mimeType: "text/plain", size },
  });
  return { owner, attachment, filePath: path.join(uploadDir, storedName) };
}

function get(id: string) {
  return downloadAttachment(new Request(`http://test/api/attachments/${id}`), ctx({ id }));
}

describe("attachment download", () => {
  it("a member downloads the file (200)", async () => {
    const { owner, attachment } = await seedAttachment();
    await loginAs(owner.id);

    const res = await get(attachment.id);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  // Regression: someone else's id gave 403 and a missing one 404, which revealed which ids exist.
  it("a non-member gets the same 404 as a missing id", async () => {
    const { attachment } = await seedAttachment();
    const stranger = await seedUser();
    await loginAs(stranger.id);

    const foreign = await get(attachment.id);
    const missing = await get("cmmissing0000000000000000");
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.text()).toBe(await missing.text());
  });

  it("gives 401 without a session", async () => {
    const { attachment } = await seedAttachment();
    expect((await get(attachment.id)).status).toBe(401);
  });

  it("a row without a file on disk gives 404 and is logged as a warning", async () => {
    const { owner, attachment, filePath } = await seedAttachment();
    await rm(filePath);
    await loginAs(owner.id);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await get(attachment.id);
    expect(res.status).toBe(404);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  // As root, chmod 000 does not prevent reading: the case cannot be reproduced and is skipped.
  it.skipIf(process.getuid?.() === 0)(
    "a read error other than ENOENT gives 500 and is logged",
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
