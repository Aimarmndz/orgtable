import { verifySession } from "@/app/lib/dal";
import { prisma } from "@/app/lib/prisma";
import { accessibleBoardsWhere } from "@/app/lib/access";
import { readAttachmentFile } from "@/app/lib/storage";

// Serves an attachment's file, with authorization. Not under /public because
// attachments are private: whoever can open the board can download them, nobody else. See
// docs/attachments.md.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const session = await verifySession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  // A single query scoped by access (app/lib/access.ts): a missing attachment and one from someone else's
  // board give the SAME 404, so as not to reveal which ids exist (like API v1).
  const attachment = await prisma.attachment.findFirst({
    where: {
      id,
      card: { list: { board: accessibleBoardsWhere(session.userId) } },
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
      // The row exists but the file does not: database and volume are out of sync.
      console.warn("[attachments] file not found on disk", {
        id,
        storedName: attachment.storedName,
      });
      return new Response("Not found", { status: 404 });
    }
    // Permissions, volume I/O…: a server failure, not a "does not exist".
    console.error("[attachments] could not read the attachment", {
      id,
      storedName: attachment.storedName,
      code,
      message: err instanceof Error ? err.message : String(err),
    });
    return new Response("Internal Server Error", { status: 500 });
  }

  // filename* (RFC 5987) preserves names with accents or spaces.
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
