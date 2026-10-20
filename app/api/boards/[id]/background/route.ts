import { verifySession } from "@/app/lib/dal";
import { prisma } from "@/app/lib/prisma";
import { effectiveBoardRole } from "@/app/lib/access";
import { readAttachmentFile } from "@/app/lib/storage";

// GET /api/boards/<id>/background: the board's background image, for whoever can open the
// board (app/lib/access.ts). Everyone else, and a board without one, gets 404. The type was
// sniffed from the bytes on upload and is sent with nosniff.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await verifySession();
  if (!session || !(await effectiveBoardRole(id, session.userId))) return new Response("Not found", { status: 404 });
  const board = await prisma.board.findUnique({
    where: { id },
    select: { backgroundImageStoredName: true, backgroundImageMimeType: true },
  });
  if (!board?.backgroundImageStoredName || !board.backgroundImageMimeType) return new Response("Not found", { status: 404 });
  try {
    const bytes = await readAttachmentFile(board.backgroundImageStoredName);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": board.backgroundImageMimeType,
        "X-Content-Type-Options": "nosniff",
        // The URL carries the stored name (?v=), so a new image is a new URL.
        "Cache-Control": "private, max-age=86400",
        "Content-Disposition": "inline",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
