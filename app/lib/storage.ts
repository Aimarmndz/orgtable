import "server-only";
import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Almacenamiento en disco de los adjuntos (Hito 5). El binario vive en un directorio
// configurable (ORGTABLE_UPLOAD_DIR); en producción es un volumen persistente (ver
// docker-compose.yml). En la base de datos solo guardamos metadatos. Ver
// docs/attachments.md y la decisión en docs/decisions/0010-local-file-storage.md.

// `turbopackIgnore`: sin él, Turbopack no puede resolver `process.cwd()` en el build y
// traza el proyecto entero (docs, test, Dockerfile, ./uploads) hacia .next/standalone.
const UPLOAD_DIR =
  process.env.ORGTABLE_UPLOAD_DIR ||
  path.join(/* turbopackIgnore: true */ process.cwd(), "uploads");

// Límite de tamaño por archivo: 10 MB.
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Ruta absoluta del fichero a partir de su nombre almacenado, a prueba de traversal. */
function storedPath(storedName: string): string {
  // basename descarta cualquier componente de ruta: nunca se sale de UPLOAD_DIR.
  return path.join(UPLOAD_DIR, path.basename(storedName));
}

/** Guarda un File en disco con un nombre aleatorio. Devuelve el nombre y el tamaño. */
export async function saveAttachmentFile(
  file: File,
): Promise<{ storedName: string; size: number }> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  // Conserva la extensión original (saneada) para que el tipo se reconozca al descargar.
  const ext = path.extname(file.name).slice(0, 16).replace(/[^.a-zA-Z0-9]/g, "");
  const storedName = `${randomUUID()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(storedPath(storedName), buffer);
  return { storedName, size: buffer.length };
}

/** Lee el binario de un adjunto (para servirlo con autorización desde el route handler). */
export async function readAttachmentFile(storedName: string): Promise<Buffer> {
  return readFile(storedPath(storedName));
}

/**
 * Borra el fichero de disco. Nunca lanza: quien la llama ya ha borrado la fila, y un
 * throw aquí rompería la acción y se saltaría la revalidación. Que el fichero ya no
 * exista (ENOENT) es normal; cualquier otro error (permisos, volumen de solo lectura…)
 * deja un binario huérfano, así que se registra para que el operador lo vea.
 */
export async function deleteAttachmentFile(storedName: string): Promise<void> {
  try {
    await unlink(storedPath(storedName));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return;
    console.error("[storage] no se pudo borrar el adjunto", { storedName, code });
  }
}
