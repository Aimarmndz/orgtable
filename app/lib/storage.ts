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

/** The directory uploads live in (instance backups copy all of it). */
export function uploadDir(): string {
  return UPLOAD_DIR;
}

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

// --- Organization logos (docs/workspaces.md, "Brand") ------------------------------------

export const MAX_LOGO_BYTES = 512 * 1024;

const LOGO_TYPES: { mime: string; ext: string; magic: (b: Buffer) => boolean }[] = [
  { mime: "image/png", ext: ".png", magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", ext: ".jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/webp",
    ext: ".webp",
    magic: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  },
];

/**
 * The image type of a logo from its first bytes (never the name or the browser's word for
 * it): PNG, JPEG or WebP. SVG is refused on purpose, it can carry scripts.
 */
export function sniffLogoType(bytes: Buffer): { mime: string; ext: string } | null {
  const found = LOGO_TYPES.find((t) => t.magic(bytes));
  return found ? { mime: found.mime, ext: found.ext } : null;
}

/** Saves a logo under a random name. */
export async function saveLogoFile(bytes: Buffer, ext: string): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const storedName = `logo-${randomUUID()}${ext}`;
  await writeFile(storedPath(storedName), bytes);
  return storedName;
}

/** Saves bytes as an attachment file under a random name (imports of backups). */
export async function saveAttachmentBytes(bytes: Buffer, ext: string): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const storedName = `${randomUUID()}${ext.replace(/[^.a-zA-Z0-9]/g, "").slice(0, 16)}`;
  await writeFile(storedPath(storedName), bytes);
  return storedName;
}
