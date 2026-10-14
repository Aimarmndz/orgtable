import { describe, it, expect, vi, afterAll, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import path from "node:path";

// The upload directory is fixed when storage.ts is imported, so the variable is set
// before any import (vi.hoisted runs first).
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
  it("deletes the stored file", async () => {
    const { storedName } = await saveAttachmentFile(
      new File(["hello"], "note.txt", { type: "text/plain" }),
    );
    expect(existsSync(path.join(uploadDir, storedName))).toBe(true);
    await deleteAttachmentFile(storedName);
    expect(existsSync(path.join(uploadDir, storedName))).toBe(false);
  });

  it("a file that no longer exists (ENOENT) logs nothing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await deleteAttachmentFile("missing.txt");
    expect(spy).not.toHaveBeenCalled();
  });

  // Regression: the empty catch swallowed any error. A directory with the attachment's
  // name makes unlink fail with EISDIR (Linux) or EPERM (macOS), not with ENOENT.
  it("other unlink errors are logged without throwing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mkdirSync(path.join(uploadDir, "is-a-directory"));
    await expect(deleteAttachmentFile("is-a-directory")).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
    const [, detail] = spy.mock.calls[0] as [string, { storedName: string; code: string }];
    expect(detail.storedName).toBe("is-a-directory");
    expect(["EISDIR", "EPERM"]).toContain(detail.code);
  });
});
