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

  const attachment = await prisma.attachment.findUnique({
    where: { id },
    select: {
      filename: true,
      storedName: true,
      mimeType: true,
      size: true,
      card: { select: { list: { select: { boardId: true } } } },
    },
  });
  if (!attachment) return new Response("Not found", { status: 404 });

  const membership = await prisma.boardMember.findUnique({
    where: {
      boardId_userId: {
        boardId: attachment.card.list.boardId,
        userId: session.userId,
      },
    },
    select: { boardId: true },
  });
  if (!membership) return new Response("Forbidden", { status: 403 });

  let data: Buffer;
  try {
    data = await readAttachmentFile(attachment.storedName);
  } catch {
    return new Response("Not found", { status: 404 });
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
