import "server-only";
import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// On-disk storage of attachments. The binary lives in a configurable directory
// (ORGTABLE_UPLOAD_DIR); in production it is a persistent volume (see docker-compose.yml).
// The database only holds metadata. See docs/attachments.md and the decision in
// docs/decisions/0010-local-file-storage.md.

// `turbopackIgnore`: without it, Turbopack cannot resolve `process.cwd()` at build time and
// traces the whole project (docs, test, Dockerfile, ./uploads) into .next/standalone.
const UPLOAD_DIR =
  process.env.ORGTABLE_UPLOAD_DIR ||
  path.join(/* turbopackIgnore: true */ process.cwd(), "uploads");

// Size limit per file: 10 MB.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Absolute path of the file from its stored name, safe against path traversal. */
function storedPath(storedName: string): string {
  // basename drops any path component: it never leaves UPLOAD_DIR.
  return path.join(UPLOAD_DIR, path.basename(storedName));
}

/** Saves a File to disk under a random name. Returns the name and the size. */
export async function saveAttachmentFile(
  file: File,
): Promise<{ storedName: string; size: number }> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  // Keeps the original (sanitised) extension so the type is recognised on download.
  const ext = path.extname(file.name).slice(0, 16).replace(/[^.a-zA-Z0-9]/g, "");
  const storedName = `${randomUUID()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(storedPath(storedName), buffer);
  return { storedName, size: buffer.length };
}

/** Reads an attachment's binary (served with authorization by the route handler). */
export async function readAttachmentFile(storedName: string): Promise<Buffer> {
  return readFile(storedPath(storedName));
}

/**
 * Deletes the file from disk. Never throws: the caller has already deleted the row, and a
 * throw here would break the action and skip revalidation. A file that no longer exists
 * (ENOENT) is normal; any other error (permissions, read-only volume…) leaves an orphan
 * binary, so it is logged for the operator to see.
 */
export async function deleteAttachmentFile(storedName: string): Promise<void> {
  try {
    await unlink(storedPath(storedName));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    console.error("[storage] could not delete the attachment", { storedName, code });
  }
}
