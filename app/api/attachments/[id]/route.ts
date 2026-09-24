import { verifySession } from "@/app/lib/dal";
import { prisma } from "@/app/lib/prisma";
import { readAttachmentFile } from "@/app/lib/storage";

// Sirve el binario de un adjunto con autorización (Hito 5). No usamos /public porque
// los adjuntos son privados: cualquier miembro del tablero puede descargarlos, nadie
// más. Ver docs/attachments.md.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await verifySession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  // Una sola consulta acotada por membresía: un adjunto que no existe y uno de un tablero
  // ajeno dan el MISMO 404, para no revelar qué ids existen (igual que la API v1).
  const attachment = await prisma.attachment.findFirst({
    where: {
      id,
      card: { list: { board: { members: { some: { userId: session.userId } } } } },
    },
    select: {
      filename: true,
      storedName: true,
      mimeType: true,
      size: true,
    },
  });
  if (!attachment) return new Response("Not found", { status: 404 });

  let data: Buffer;
  try {
    data = await readAttachmentFile(attachment.storedName);
  } catch (err) {
    const code = isErrnoException(err) ? err.code : undefined;
    if (code === "ENOENT") {
      // La fila existe pero el fichero no: inconsistencia entre BD y volumen.
      console.warn("[attachments] fichero no encontrado en disco", {
        id,
        storedName: attachment.storedName,
      });
      return new Response("Not found", { status: 404 });
    }
    // Permisos, E/S del volumen…: es un fallo del servidor, no un «no existe».
    console.error("[attachments] no se pudo leer el adjunto", {
      id,
      storedName: attachment.storedName,
      code,
      message: err instanceof Error ? err.message : String(err),
    });
    return new Response("Internal Server Error", { status: 500 });
  }

  // filename* (RFC 5987) preserva nombres con acentos o espacios.
  const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(
    attachment.filename,
  )}`;

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(attachment.size),
      "Content-Disposition": disposition,
      "Cache-Control": "private, no-store",
    },
  });
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && typeof (err as { code?: unknown }).code === "string";
}
